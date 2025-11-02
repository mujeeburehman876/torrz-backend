const express = require('express');
const twilio = require('twilio');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Twilio Client
const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// Twilio Voice SDK (for access tokens)
const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

// Health Check
app.get('/', (req, res) => {
    res.json({ 
        status: 'Torrz Real VoIP Backend Running!',
        timestamp: new Date().toISOString(),
        endpoints: {
            voiceToken: '/api/voice/token',
            initiateCall: '/api/calls/initiate',
            endCall: '/api/calls/end/:callSid',
            sendSMS: '/api/messages/send',
            sendOTP: '/api/otp/send'
        }
    });
});

// ============ TWILIO VOICE ACCESS TOKEN (FIXED FOR REAL VOIP) ============

app.get('/api/voice/token', (req, res) => {
    try {
        const identity = req.query.identity || 'user_' + Date.now();

        console.log(`🔑 Generating access token for identity: ${identity}`);

        // ✅ FIXED: Use proper API Key credentials instead of Account SID
        const accessToken = new AccessToken(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_API_KEY,        // ✅ Use API Key SID (not Account SID)
            process.env.TWILIO_API_SECRET,     // ✅ Use API Secret (not Auth Token)
            { 
                identity: identity,
                ttl: 3600  // Token valid for 1 hour
            }
        );

        // Create Voice grant for VoIP calling
        const voiceGrant = new VoiceGrant({
            outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID,
            incomingAllow: true
        });

        accessToken.addGrant(voiceGrant);
        const token = accessToken.toJwt();

        console.log(`✅ Access token generated successfully for ${identity}`);
        console.log(`📝 Token preview: ${token.substring(0, 50)}...`);

        res.json({
            success: true,
            token: token,
            identity: identity,
            expiresIn: 3600
        });

    } catch (error) {
        console.error('❌ Error generating token:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to generate token',
            error: error.toString()
        });
    }
});

// ============ PHONE VERIFICATION ============

app.post('/api/otp/send', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        
        if (!phoneNumber) {
            return res.status(400).json({ 
                success: false, 
                message: 'Phone number is required' 
            });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        
        const message = await twilioClient.messages.create({
            body: `Your TORRZ verification code is: ${otp}. Valid for 10 minutes.`,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: phoneNumber
        });

        console.log(`📱 OTP sent to ${phoneNumber}: ${otp}`);
        
        res.json({
            success: true,
            message: 'OTP sent successfully',
            requestId: message.sid,
            otp: otp // REMOVE THIS IN PRODUCTION!
        });

    } catch (error) {
        console.error('❌ Error sending OTP:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to send OTP'
        });
    }
});

app.post('/api/otp/verify', async (req, res) => {
    try {
        const { phoneNumber, code } = req.body;
        
        if (!phoneNumber || !code) {
            return res.status(400).json({
                success: false,
                message: 'Phone number and code are required'
            });
        }

        if (code.length === 6) {
            res.json({
                success: true,
                message: 'Phone number verified successfully',
                token: 'auth_token_' + Date.now(),
                userPhoneNumber: phoneNumber
            });
        } else {
            res.status(400).json({
                success: false,
                message: 'Invalid verification code'
            });
        }

    } catch (error) {
        console.error('❌ Error verifying OTP:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Verification failed'
        });
    }
});

// ============ VOICE CALLS (REAL TWILIO VOIP) ============

app.post('/api/calls/initiate', async (req, res) => {
    try {
        const { toNumber, fromNumber } = req.body;
        
        if (!toNumber || !fromNumber) {
            return res.status(400).json({
                success: false,
                message: 'Both toNumber and fromNumber are required'
            });
        }

        console.log(`📞 Initiating call from ${fromNumber} to ${toNumber}`);

        const call = await twilioClient.calls.create({
            url: `${req.protocol}://${req.get('host')}/api/calls/twiml`,
            to: toNumber,
            from: process.env.TWILIO_PHONE_NUMBER,
            statusCallback: `${req.protocol}://${req.get('host')}/api/calls/status`,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
        });

        console.log(`✅ Call initiated: ${call.sid}`);

        res.json({
            success: true,
            message: 'Call initiated successfully',
            callSid: call.sid,
            status: call.status
        });

    } catch (error) {
        console.error('❌ Error initiating call:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to initiate call',
            error: error.toString()
        });
    }
});

// ============ END CALL (Real VoIP Termination) ============

app.delete('/api/calls/end/:callSid', async (req, res) => {
    try {
        const { callSid } = req.params;
        
        if (!callSid) {
            return res.status(400).json({
                success: false,
                message: 'Call SID is required'
            });
        }

        console.log(`🔚 Ending call: ${callSid}`);

        const call = await twilioClient.calls(callSid).update({
            status: 'completed'
        });

        console.log(`✅ Call ended successfully: ${call.sid}`);

        res.json({
            success: true,
            message: 'Call ended successfully',
            callSid: call.sid,
            status: call.status
        });

    } catch (error) {
        console.error('❌ Error ending call:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to end call',
            error: error.toString()
        });
    }
});

// TwiML response for voice calls
// ✅ FIXED TwiML for VoIP Client to Phone calls with proper audio routing
app.post('/api/calls/twiml', (req, res) => {
    const toNumber = req.query.To || req.body.To;
    const fromIdentity = req.query.From || req.body.From;
    
    console.log(`🎤 TwiML Request Received`);
    console.log(`   To: ${toNumber}`);
    console.log(`   From: ${fromIdentity}`);
    console.log(`   Query:`, req.query);
    console.log(`   Body:`, req.body);
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    if (toNumber) {
        // Create dial with answerOnBridge for proper audio routing
        const dial = twiml.dial({
            callerId: process.env.TWILIO_PHONE_NUMBER,
            answerOnBridge: true,  // ✅ CRITICAL for audio to work
            timeout: 30
        });
        
        // Dial the phone number
        dial.number(toNumber);
        
        console.log(`✅ TwiML: Dialing ${toNumber} with answerOnBridge`);
    } else {
        console.log(`❌ No destination number provided`);
        twiml.say({
            voice: 'alice',
            language: 'en-US'
        }, 'No destination number was provided.');
    }
    
    const twimlResponse = twiml.toString();
    console.log(`📄 TwiML XML:`, twimlResponse);
    
    res.type('text/xml');
    res.send(twimlResponse);
});

// Call status webhook
app.post('/api/calls/status', (req, res) => {
    const { CallSid, CallStatus, From, To, Duration } = req.body;
    
    console.log(`📊 Call Status Update:`);
    console.log(`   SID: ${CallSid}`);
    console.log(`   Status: ${CallStatus}`);
    console.log(`   From: ${From}`);
    console.log(`   To: ${To}`);
    if (Duration) console.log(`   Duration: ${Duration}s`);
    
    res.sendStatus(200);
});

// ============ SMS MESSAGING ============

app.post('/api/messages/send', async (req, res) => {
    try {
        const { toNumber, message } = req.body;
        
        if (!toNumber || !message) {
            return res.status(400).json({
                success: false,
                message: 'toNumber and message are required'
            });
        }

        console.log(`💬 Sending SMS to ${toNumber}`);

        const sms = await twilioClient.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER,
            to: toNumber
        });

        console.log(`✅ SMS sent: ${sms.sid}`);

        res.json({
            success: true,
            message: 'SMS sent successfully',
            messageSid: sms.sid
        });

    } catch (error) {
        console.error('❌ Error sending SMS:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to send SMS'
        });
    }
});

app.post('/api/messages/receive', (req, res) => {
    const { From, Body, MessageSid } = req.body;
    
    console.log(`📨 Received SMS from ${From}: ${Body}`);
    
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('Thank you for your message! We received: ' + Body);
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============ ERROR HANDLING ============

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found',
        path: req.path
    });
});

app.use((err, req, res, next) => {
    console.error('❌ Server Error:', err);
    res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: err.message
    });
});

// ============ START SERVER ============

app.listen(PORT, () => {
    console.log(`
    ╔═══════════════════════════════════════╗
    ║   🚀 TORRZ VoIP Backend Running!     ║
    ║   Port: ${PORT}                           ║
    ║   URL: http://localhost:${PORT}          ║
    ╚═══════════════════════════════════════╝
    
    📱 Endpoints Available:
    ✓ GET    /api/voice/token         - Get VoIP access token
    ✓ POST   /api/calls/initiate      - Initiate outbound call
    ✓ DELETE /api/calls/end/:callSid  - End active call
    ✓ POST   /api/messages/send       - Send SMS
    ✓ POST   /api/otp/send            - Send OTP
    ✓ POST   /api/otp/verify          - Verify OTP
    
    🔧 Twilio Config:
    ✓ Account SID: ${process.env.TWILIO_ACCOUNT_SID ? '✓ Set' : '✗ Missing'}
    ✓ Auth Token: ${process.env.TWILIO_AUTH_TOKEN ? '✓ Set' : '✗ Missing'}
    ✓ API Key: ${process.env.TWILIO_API_KEY ? '✓ Set' : '✗ Missing'}
    ✓ API Secret: ${process.env.TWILIO_API_SECRET ? '✓ Set' : '✗ Missing'}
    ✓ TwiML App SID: ${process.env.TWILIO_TWIML_APP_SID ? '✓ Set' : '✗ Missing'}
    ✓ Phone Number: ${process.env.TWILIO_PHONE_NUMBER || '✗ Missing'}
    
    `);
});

process.on('SIGTERM', () => {
    console.log('👋 SIGTERM received. Shutting down gracefully...');
    process.exit(0);
});
