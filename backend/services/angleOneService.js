const axios = require('axios');
const { TOTP } = require('totp-generator');

class AngleOneService {
  constructor() {
    this.apiKey = process.env.ANGLE_ONE_API_KEY;
    this.clientId = process.env.ANGLE_ONE_CLIENT_ID;
    this.password = process.env.ANGLE_ONE_PASSWORD; // This is usually your MPIN
    this.totpSecret = process.env.ANGLE_ONE_TOTP_SECRET;
    
    this.jwtToken = null;
    this.feedToken = null;
    this.refreshToken = null;
    
    // Angle One requires these headers, but they don't block you based on them when using TOTP. 
    // We provide standard dummy values here.
    this.macAddress = "00-B0-D0-63-C2-26"; 
    this.clientLocalIp = "192.168.168.168"; 
    this.clientPublicIp = "106.193.147.98"; 
  }

  async login() {
    try {
      if (!this.totpSecret || !this.clientId || !this.apiKey) {
         console.log('⚠️ Angle One credentials missing in .env');
         return false;
      }

      // 1. Generate live TOTP PIN using the secret you generated
      const { otp: currentTotp } = await TOTP.generate(this.totpSecret);
      
      console.log('Attempting Angle One Login with TOTP...');

      // 2. Make the login request
      const response = await axios.post(
        'https://apiconnect.angelbroking.com/rest/auth/angelbroking/user/v1/loginByPassword',
        {
          clientcode: this.clientId,
          password: this.password,
          totp: currentTotp
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-UserType': 'USER',
            'X-SourceID': 'WEB',
            'X-ClientLocalIP': this.clientLocalIp,
            'X-ClientPublicIP': this.clientPublicIp,
            'X-MACAddress': this.macAddress,
            'X-PrivateKey': this.apiKey
          }
        }
      );

      if (response.data && response.data.status) {
        this.jwtToken = response.data.data.jwtToken;
        this.refreshToken = response.data.data.refreshToken;
        this.feedToken = response.data.data.feedToken;
        console.log('✅ Angle One Login Successful! TOTP bypass worked.');
        return true;
      } else {
        console.error('❌ Angle One Login Failed:', response.data.message);
        return false;
      }
    } catch (error) {
      console.error('❌ Angle One API Error:', error.response?.data || error.message);
      return false;
    }
  }

  // Use this for making future buy/sell calls
  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-ClientLocalIP': this.clientLocalIp,
      'X-ClientPublicIP': this.clientPublicIp,
      'X-MACAddress': this.macAddress,
      'X-PrivateKey': this.apiKey,
      'Authorization': `Bearer ${this.jwtToken}`
    };
  }
  async getQuote(exchange, token) {
    if (!this.jwtToken) return null;
    try {
      const response = await axios.post(
        'https://apiconnect.angelbroking.com/rest/secure/angelbroking/market/v1/quote/',
        {
          mode: "FULL",
          exchangeTokens: {
            [exchange]: [token]
          }
        },
        { headers: this.getHeaders() }
      );
      
      if (response.data && response.data.status && response.data.data && response.data.data.fetched) {
        const fetchedData = response.data.data.fetched;
        const item = fetchedData.find(f => f.exchange === exchange);
        if (item && item.ltp) {
          return item.ltp;
        }
      }
      return null;
    } catch (err) {
      console.error(`❌ Angle One Quote Error for ${exchange}:${token}:`, err.response?.data || err.message);
      return null;
    }
  }

  async getHistoricData(exchange, token, interval = "FIVE_MINUTE", daysBack = 5) {
    if (!this.jwtToken) return [];
    try {
      const now = new Date();
      const formatDt = (d) => {
          const pad = (n) => n.toString().padStart(2, '0');
          return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      
      const toDate = formatDt(now);
      const fromD = new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000));
      const fromDate = formatDt(fromD);

      const response = await axios.post(
        'https://apiconnect.angelbroking.com/rest/secure/angelbroking/historical/v1/getCandleData',
        {
          exchange: exchange,
          symboltoken: token,
          interval: interval,
          fromdate: fromDate,
          todate: toDate
        },
        { headers: this.getHeaders() }
      );

      if (response.data && response.data.status && response.data.data) {
        return response.data.data.map(c => ({
            timestamp: c[0],
            open: parseFloat(c[1]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3]),
            close: parseFloat(c[4]),
            volume: parseInt(c[5])
        }));
      }
      return [];
    } catch (err) {
      console.error(`❌ Angle One Historic Error:`, err.response?.data || err.message);
      return [];
    }
  }
}

module.exports = new AngleOneService();
