const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

let sock = null;
const authDir = path.join(__dirname, 'auth_info');

const cleanPhoneNumber = (phone) => phone ? String(phone).replace(/\+/g, '').replace(/\D/g, '') : '';

const startClient = async (messageHandler) => {
  try {
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['Ubuntu', 'Chrome', '20.0.0'],
      markOnlineOnConnect: false,
      syncFullHistory: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(shouldReconnect ? '🔄 إعادة الاتصال بعد 3 ثوانٍ...' : '❌ تم تسجيل الخروج.');
        if (shouldReconnect) setTimeout(() => startClient(messageHandler), 3000);
      } else if (connection === 'open') {
        console.log('✅ البوت متصل وجاهز للعمل!');
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;
      const msg = m.messages[0];
      if (!msg.message || !msg.key?.remoteJid) return;

      let sender = msg.key.remoteJid;
      sender = sender.replace('@lid.us', '@s.whatsapp.net').split('@')[0];

      const text = msg.message.conversation ||
                   msg.message.extendedTextMessage?.text ||
                   msg.message.buttonsResponseMessage?.selectedButtonId ||
                   msg.message.listResponseMessage?.singleSelectReply?.selectedRowId || '';

      await messageHandler(sender, text.trim(), msg);
    });

    if (!fs.existsSync(path.join(authDir, 'creds.json'))) {
      console.log('⏳ جاري إنشاء كود الربط المؤقت...');
      await new Promise(res => setTimeout(res, 2000));

      const phone = cleanPhoneNumber(process.env.PHONE_NUMBER);
      if (!phone) {
        console.error('❌ لم يتم تحديد PHONE_NUMBER');
        process.exit(1);
      }

      try {
        const pairingCode = await sock.requestPairingCode(phone);
        console.log('🔴🔴🔴 الكود المؤقت للربط (8 أرقام): 🔴🔴🔴');
        console.log(`🔑 ${pairingCode}`);
        console.log('💡 انسخ الكود من سجلات التشغيل (Logs) واربطه من هاتفك:');
        console.log('   واتساب > إعدادات > أجهزة مرتبطة > ربط جهاز > ربط برقم الهاتف');
      } catch (err) {
        console.error('❌ فشل في إنشاء الكود:', err.message);
      }
    } else {
      console.log('✅ تم اكتشاف جلسة محفوظة. جاري الاستعادة...');
    }

  } catch (err) {
    console.error('❌ خطأ فادح في التشغيل:', err.message);
    process.exit(1);
  }
};

const sendMessage = async (jid, text, buttons = []) => {
  if (!sock) return;
  if (!jid.includes('@')) jid += '@s.whatsapp.net';
  jid = jid.replace('@lid.us', '@s.whatsapp.net');

  try {
    if (buttons.length > 0) {
      let btnText = text + '\n\n';
      buttons.forEach((b, i) => { btnText += `*${i + 1}.* ${b.label}\n`; });
      await sock.sendMessage(jid, { text: btnText });
    } else {
      await sock.sendMessage(jid, { text });
    }
  } catch (e) {
    console.error('❌ فشل في الإرسال:', e.message);
  }
};

module.exports = { startClient, sendMessage };
