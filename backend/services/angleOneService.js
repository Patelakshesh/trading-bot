const axios = require('axios');
const totp = require('totp-generator');

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
      const currentTotp = totp(this.totpSecret);
      
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
}

module.exports = new AngleOneService();
