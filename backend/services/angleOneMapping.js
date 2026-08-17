const axios = require('axios');

class AngleOneMapping {
    constructor() {
        this.tokenMap = new Map(); // Key: 'RELIANCE-EQ', Value: { token: '2885', exch_seg: 'NSE' }
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
                const response = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json', { timeout: 8000 });
                const data = response.data;
                
                for (const item of data) {
                    // Create keys based on standard symbols
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
                        // We store MCX futures by name and expiry, or just keeping the closest expiry
                        const key = `MCX-${item.name}`;
                        if (!this.tokenMap.has(key)) {
                            this.tokenMap.set(key, { token: item.token, exch_seg: item.exch_seg, expiry: item.expiry });
                        } else {
                            // Try to keep the one with the nearest expiry (rough logic)
                            const existing = this.tokenMap.get(key);
                            if (new Date(item.expiry) < new Date(existing.expiry) && new Date(item.expiry) > new Date()) {
                                this.tokenMap.set(key, { token: item.token, exch_seg: item.exch_seg, expiry: item.expiry });
                            }
                        }
                    }
                }
                
                // Specific manual overrides for common indices
                this.tokenMap.set('NIFTY', { token: '26000', exch_seg: 'NSE' });
                this.tokenMap.set('BANKNIFTY', { token: '26009', exch_seg: 'NSE' });

                this.isLoaded = true;
                console.log(`Angle One Mapping Loaded: ${this.tokenMap.size} symbols mapped.`);
            } catch (err) {
                console.error('Failed to load Angle One mapping JSON (ECONNRESET). Using manual overrides instead.');
                this.isLoaded = true; // Set to true so we can still use Nifty and Crude
            }
        })();

        return this.fetchPromise;
    }

    getToken(symbol) {
        if (!symbol) return null;
        symbol = symbol.toUpperCase();
        // symbol like "RELIANCE.NS"
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
    // Falls back to the last known token only if the instrument master failed to load.
    getCrudeOilMiniToken() {
        // The MCX nearest-expiry picker stores CRUDEOILM under 'MCX-CRUDEOILM'
        const fromMaster = this.tokenMap.get('MCX-CRUDEOILM');
        if (fromMaster && fromMaster.token) {
            console.log(`🔄 [CrudeAutoRoller] Using live token: ${fromMaster.token} (expires ${fromMaster.expiry})`);
            return fromMaster;
        }
        // Also try the key set by manual override on failed JSON load
        const fromOverride = this.tokenMap.get('MCX-CRUDEOIL');
        if (fromOverride && fromOverride.token) {
            console.warn(`⚠️ [CrudeAutoRoller] Instrument master not loaded. Using fallback token: ${fromOverride.token}`);
            return fromOverride;
        }
        // Absolute last resort — log clearly so you know it's stale
        console.error(`❌ [CrudeAutoRoller] No valid CRUDEOILM token found! Using emergency hardcoded token. Please check AngleOne API connectivity.`);
        return { token: '560978', exch_seg: 'MCX' };
    }
}

module.exports = new AngleOneMapping();
