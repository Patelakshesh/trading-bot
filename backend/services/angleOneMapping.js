const axios = require('axios');

class AngleOneMapping {
    constructor() {
        this.tokenMap = new Map(); // Key: 'RELIANCE-EQ', Value: { token: '2885', exch_seg: 'NSE' }
        this.nfoOptions = []; // Full NFO option chain instruments
        this.isLoaded = false;
        this.fetchPromise = null;
    }

    async init() {
        if (this.isLoaded) return;
        if (this.fetchPromise) return this.fetchPromise;

        this.fetchPromise = (async () => {
            // Load manual overrides immediately so they always work!
            this.tokenMap.set('NIFTY', { token: '26000', exch_seg: 'NSE' });
            this.tokenMap.set('BANKNIFTY', { token: '26009', exch_seg: 'NSE' });
            // NOTE: CRUDEOILM token is NOT hardcoded here anymore — it is auto-discovered
            // from the AngleOne Instrument Master JSON below (nearest expiry logic).
            
            try {
                console.log('Downloading Angle One Instrument Master... (this takes a few seconds)');
                const response = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json', { timeout: 15000 });
                const data = response.data;
                
                for (const item of data) {
                    // For NSE Equity: 'RELIANCE-EQ'
                    if (item.exch_seg === 'NSE' && item.instrumenttype === '') {
                        this.tokenMap.set(`${item.symbol}-EQ`, { token: item.token, exch_seg: item.exch_seg });
                    }
                    // For BSE Equity
                    if (item.exch_seg === 'BSE') {
                        this.tokenMap.set(`${item.symbol}-BSE`, { token: item.token, exch_seg: item.exch_seg });
                    }
                    // For Indices like Nifty 50
                    if (item.exch_seg === 'NSE' && item.instrumenttype === 'AMXIDX') {
                        this.tokenMap.set(item.name, { token: item.token, exch_seg: item.exch_seg });
                    }
                    // For MCX (Crude, Gold)
                    if (item.exch_seg === 'MCX' && item.instrumenttype === 'FUTCOM') {
                        const key = `MCX-${item.name}`;
                        if (!this.tokenMap.has(key)) {
                            this.tokenMap.set(key, { token: item.token, exch_seg: item.exch_seg, expiry: item.expiry });
                        } else {
                            const existing = this.tokenMap.get(key);
                            if (new Date(item.expiry) < new Date(existing.expiry) && new Date(item.expiry) > new Date()) {
                                this.tokenMap.set(key, { token: item.token, exch_seg: item.exch_seg, expiry: item.expiry });
                            }
                        }
                    }

                    // ═══════════════════════════════════════════════════════════
                    // 🆕 NFO OPTION CHAIN: Collect NIFTY & BANKNIFTY options
                    // for real-time OI fetching (OPTIDX = Index Options on NFO)
                    // ═══════════════════════════════════════════════════════════
                    if (item.exch_seg === 'NFO' && item.instrumenttype === 'OPTIDX') {
                        const name = (item.name || '').toUpperCase();
                        if (name === 'NIFTY' || name === 'BANKNIFTY') {
                            this.nfoOptions.push({
                                token: item.token,
                                symbol: item.symbol,        // e.g. 'NIFTY04SEP2524200CE'
                                name: item.name,             // e.g. 'NIFTY'
                                strike: parseFloat(item.strike) / 100, // Angel stores strike * 100
                                optionType: item.symbol.endsWith('CE') ? 'CE' : 'PE',
                                expiry: item.expiry,
                                lotSize: parseInt(item.lotsize) || 25
                            });
                        }
                    }
                }
                
                // Specific manual overrides for common indices
                this.tokenMap.set('NIFTY', { token: '26000', exch_seg: 'NSE' });
                this.tokenMap.set('BANKNIFTY', { token: '26009', exch_seg: 'NSE' });

                this.isLoaded = true;
                console.log(`✅ Angle One Mapping Loaded: ${this.tokenMap.size} symbols + ${this.nfoOptions.length} NFO option contracts mapped.`);
            } catch (err) {
                console.error('Failed to load Angle One mapping JSON (ECONNRESET). Using manual overrides instead.');
                this.isLoaded = true;
            }
        })();

        return this.fetchPromise;
    }

    /**
     * 🆕 Get the nearest-expiry option chain strike tokens for NIFTY or BANKNIFTY
     * Returns array of { token, symbol, strike, optionType, expiry, lotSize }
     * for the nearest weekly expiry, filtered to ±5 strikes around ATM
     * 
     * @param {string} indexName - 'NIFTY' or 'BANKNIFTY'
     * @param {number} spotPrice - Current index spot price to determine ATM
     * @param {number} numStrikes - Number of strikes on each side of ATM (default 5)
     */
    getNFOOptionChainTokens(indexName = 'NIFTY', spotPrice = 24200, numStrikes = 5) {
        const name = indexName.toUpperCase();
        const step = name === 'BANKNIFTY' ? 100 : 50;

        // Filter to the specific index
        const indexOptions = this.nfoOptions.filter(o => o.name === name);
        
        if (indexOptions.length === 0) {
            console.warn(`⚠️ No NFO options found for ${name}. Instrument master may not have loaded.`);
            return [];
        }

        // Find the nearest weekly expiry (first expiry that is in the future)
        const now = new Date();
        const expiries = [...new Set(indexOptions.map(o => o.expiry))].sort((a, b) => new Date(a) - new Date(b));
        const nearestExpiry = expiries.find(e => new Date(e) >= now);

        if (!nearestExpiry) {
            console.warn(`⚠️ No future expiry found for ${name}.`);
            return [];
        }

        // Filter to only the nearest expiry
        const expiryOptions = indexOptions.filter(o => o.expiry === nearestExpiry);

        // Calculate ATM strike
        const atmStrike = Math.round(spotPrice / step) * step;

        // Get strikes around ATM
        const strikes = [];
        for (let i = -numStrikes; i <= numStrikes; i++) {
            strikes.push(atmStrike + (i * step));
        }

        // Filter options to only our desired strikes
        const result = expiryOptions.filter(o => strikes.includes(o.strike));

        console.log(`📊 [NFO Chain] ${name}: ATM=${atmStrike}, Expiry=${nearestExpiry}, Found ${result.length} option contracts (±${numStrikes} strikes)`);
        return result;
    }

    getToken(symbol) {
        if (!symbol) return null;
        symbol = symbol.toUpperCase();
        if (symbol === 'NIFTY' || symbol === '^NSEI') return this.tokenMap.get('NIFTY');
        if (symbol === 'BANKNIFTY' || symbol === '^NSEBANK') return this.tokenMap.get('BANKNIFTY');
        if (symbol === 'CRUDE' || symbol === 'CRUDEOIL' || symbol === 'CRUDEOILM' || symbol === 'CRUDEOILM.MCX') return this.getCrudeOilMiniToken();
        if (symbol === 'GOLD') return this.tokenMap.get('MCX-GOLD');

        const cleanSymbol = symbol.split('.')[0];
        if (symbol.endsWith('.BO')) {
            return this.tokenMap.get(`${cleanSymbol}-BSE`);
        } else {
            return this.tokenMap.get(`${cleanSymbol}-EQ`);
        }
    }

    // Returns the active (nearest non-expired) CRUDEOILM Mini token from the instrument master.
    getCrudeOilMiniToken() {
        const fromMaster = this.tokenMap.get('MCX-CRUDEOILM');
        if (fromMaster && fromMaster.token) {
            console.log(`🔄 [CrudeAutoRoller] Using live token: ${fromMaster.token} (expires ${fromMaster.expiry})`);
            return fromMaster;
        }
        const fromOverride = this.tokenMap.get('MCX-CRUDEOIL');
        if (fromOverride && fromOverride.token) {
            console.warn(`⚠️ [CrudeAutoRoller] Instrument master not loaded. Using fallback token: ${fromOverride.token}`);
            return fromOverride;
        }
        console.error(`❌ [CrudeAutoRoller] No valid CRUDEOILM token found! Using emergency hardcoded token.`);
        return { token: '560978', exch_seg: 'MCX' };
    }
}

module.exports = new AngleOneMapping();
