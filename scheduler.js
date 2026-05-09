const cron = require('node-cron');
const db = require('./db');
const { sendMessage } = require('./client');
require('dotenv').config();

cron.schedule('*/5 * * * *', async () => {
  try {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const appointments = db.getAllAppointments().filter(a => a.date === today && a.status === 'confirmed' && !a.reminderSent);

    for (const apt of appointments) {
      const [h, m] = apt.time.split(':').map(Number);
      const aptMinutes = h * 60 + m;
      const diff = aptMinutes - currentMinutes;
      if (diff > 0 && diff <= 15) {
        await sendMessage(apt.phone, `⏳ *تذكير بالموعد*\nموعدك بعد ${diff} دقيقة (الساعة ${apt.time})\n📍 ${process.env.CLINIC_ADDRESS}`);
        db.markReminderSent(apt.id);
      }
    }
  } catch (e) { console.error('Scheduler error:', e.message); }
});

cron.schedule('0 20 * * *', async () => {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    const list = db.getAppointments(dateStr);
    let msg = `📊 *مواعيد غداً (${dateStr}):*\n`;
    if (list.length === 0) msg += 'لا توجد حجوزات.';
    else list.forEach((a, i) => { msg += `${i + 1}. ${a.name} - ${a.time}\n`; });
    if (process.env.DOCTOR_PHONE) await sendMessage(process.env.DOCTOR_PHONE, msg);
  } catch (e) { console.error('Doctor schedule error:', e.message); }
});
