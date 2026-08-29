const { WebSocketV2 } = require('smartapi-javascript');
const angleOneService = require('./angleOneService');
const angleOneMapping = require('./angleOneMapping');

class RealtimeEngine {
    constructor() {
        this.webSocket = null;
        this.isConnected = false;
        this.tickStore = new Map(); // token -> { ltp, open, high, low, close, volume, vwap, buyQty, sellQty, oi, lastUpdated }
        this.vwapAccumulators = new Map(); // token -> { cumulativeVolume, cumulativePV }
        this.subscribedTokens = new Set();
        this.isReconnecting = false;
    }

    async init() {
        try {
            await angleOneService.ensureLoggedIn();
            if (!angleOneService.jwtToken || !angleOneService.apiKey || !angleOneService.clientId || !angleOneService.feedToken) {
                console.log('⚠️ [RealtimeEngine] Missing WebSocket credentials, will use high-speed REST fallback.');
                return false;
            }

            this.webSocket = new WebSocketV2({
                jwttoken: angleOneService.jwtToken,
                apikey: angleOneService.apiKey,
                clientcode: angleOneService.clientId,
                feedtype: angleOneService.feedToken
            });

            this.webSocket.connect().then(() => {
                console.log('⚡ [RealtimeEngine] Angel One 0-Second WebSocket Connected!');
                this.isConnected = true;
                this.isReconnecting = false;
                this.resubscribeAll();
            }).catch(err => {
                console.warn('⚠️ [RealtimeEngine] WebSocket connect error (using REST stream):', err.message);
                this.isConnected = false;
            });

            this.webSocket.on('tick', (tickData) => {
                this.handleTick(tickData);
            });

            this.webSocket.on('error', (err) => {
                console.error('❌ [RealtimeEngine] WebSocket error:', err.message || err);
                this.reconnect();
            });

            this.webSocket.on('close', () => {
                console.warn('⚠️ [RealtimeEngine] WebSocket connection closed. Reconnecting...');
                this.isConnected = false;
                this.reconnect();
            });

            return true;
        } catch (e) {
            console.error('❌ [RealtimeEngine] Init error:', e.message);
            return false;
        }
    }

    handleTick(data) {
        if (!data || !data.token) return;
        const token = data.token.toString();
        const ltp = parseFloat(data.last_traded_price || data.ltp || 0) / (data.last_traded_price ? 100 : 1);
        const volume = parseFloat(data.volume_trade_for_the_day || data.volume || 0);
        const buyQty = parseFloat(data.total_buy_quantity || 0);
        const sellQty = parseFloat(data.total_sell_quantity || 0);
        const oi = parseFloat(data.open_interest || 0);

        if (ltp <= 0) return;

        // Calculate True Tick-by-Tick VWAP
        if (!this.vwapAccumulators.has(token)) {
            this.vwapAccumulators.set(token, { cumulativeVolume: 0, cumulativePV: 0 });
        }
        const acc = this.vwapAccumulators.get(token);
        const prevData = this.tickStore.get(token) || {};
        const deltaVol = Math.max(1, volume - (prevData.volume || 0));
        
        acc.cumulativeVolume += deltaVol;
        acc.cumulativePV += (ltp * deltaVol);
        const calculatedVWAP = acc.cumulativeVolume > 0 ? (acc.cumulativePV / acc.cumulativeVolume) : ltp;

        const updated = {
            token,
            ltp,
            open: prevData.open || ltp,
            high: Math.max(prevData.high || ltp, ltp),
            low: Math.min(prevData.low || ltp, ltp),
            close: ltp,
            volume,
            vwap: parseFloat(calculatedVWAP.toFixed(2)),
            buyQty,
            sellQty,
            oi,
            buyerDominance: (buyQty + sellQty > 0) ? Math.round((buyQty / (buyQty + sellQty)) * 100) : 50,
            lastUpdated: Date.now()
        };

        this.tickStore.set(token, updated);
    }

    subscribe(exchangeType, token) {
        if (!token) return;
        const tokStr = token.toString();
        this.subscribedTokens.add({ exchangeType, token: tokStr });

        if (this.isConnected && this.webSocket) {
            try {
                this.webSocket.fetchData({
                    correlationID: `sub_${tokStr}`,
                    action: 1,
                    mode: 2, // Mode 2 = Full Quote (LTP, Volume, Depth, OI)
                    exchangeType: exchangeType, // 1=NSE, 2=NFO, 5=MCX
                    tokens: [tokStr]
                });
            } catch (e) {
                console.error('Subscription error:', e.message);
            }
        }
    }

    resubscribeAll() {
        for (const item of this.subscribedTokens) {
            this.subscribe(item.exchangeType, item.token);
        }
    }

    reconnect() {
        if (this.isReconnecting) return;
        this.isReconnecting = true;
        setTimeout(() => {
            console.log('🔄 [RealtimeEngine] Attempting WebSocket reconnect...');
            this.init();
        }, 5000);
    }

    getTick(token) {
        if (!token) return null;
        return this.tickStore.get(token.toString()) || null;
    }
}

module.exports = new RealtimeEngine();
