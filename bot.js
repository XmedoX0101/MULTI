const db = require('./db');
const { sendMessage } = require('./client');
require('dotenv').config();

const sessions = new Map();

const getLocalDate = () => {
  const now = new Date();
  const offset = parseInt(process.env.TIMEZONE_OFFSET) || 120;
  return new Date(now.getTime() + offset * 60000);
};

const getAvailableSlots = (date) => {
  const booked = db.getAppointments(date).map(a => a.time);
  const slots = [];
  const startHour = parseInt(process.env.WORK_START);
  const endHour = parseInt(process.env.WORK_END);
  const duration = parseInt(process.env.SLOT_MINUTES);

  for (let h = startHour; h < endHour; h++) {
    for (let m = 0; m < 60; m += duration) {
      const time = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      if (!booked.includes(time)) slots.push(time);
    }
  }
  return slots;
};

const handleWebhook = async (from, text, rawMsg) => {
  let session = sessions.get(from) || { step: 'start' };

  const existing = db.getAppointmentByPhone(from);
  if (existing && !['1', 'الرئيسية', '🔙 الرئيسية'].includes(text)) {
    return sendMessage(from, `⛔ لديك ميعاد محجوز بالفعل:\n📅 ${existing.date} | ⏰ ${existing.time}\nللحجز برقم آخر، استخدم رقم هاتف مختلف.`, [{ label: 'الرئيسية' }]);
  }

  if (session.step === 'start' || text === 'الرئيسية' || text === '🔙 الرئيسية') {
    session = { step: 'menu' };
    sessions.set(from, session);
    return sendMessage(from, `🏥 *عيادتنا الطبية*\n💰 سعر الكشف: ${process.env.CLINIC_FEE} ج.م\nاختار الخدمة:`, [
      { label: '1. 📅 حجز ميعاد' },
      { label: '2. ℹ️ معلومات' },
      { label: '3. 📞 تواصل' }
    ]);
  }

  if (session.step === 'menu') {
    if (text === '1' || text.includes('حجز')) {
      session = { step: 'name' };
      sessions.set(from, session);
      return sendMessage(from, '✍️ *اكتب اسمك الثلاثي:*');
    } else if (text === '2' || text.includes('معلومات')) {
      return sendMessage(from, `📋 *معلومات العيادة:*\n🕐 مواعيد العمل: ${process.env.WORK_START}:00 - ${process.env.WORK_END}:00\n💰 الكشف: ${process.env.CLINIC_FEE} ج.م\n📍 ${process.env.CLINIC_ADDRESS}`, [{ label: '🔙 الرئيسية' }]);
    } else if (text === '3' || text.includes('تواصل')) {
      return sendMessage(from, `📞 *تواصل معنا:*\n📱 للطوارئ: ${process.env.DOCTOR_PHONE}\n⏰ من ${process.env.WORK_START} ص - ${process.env.WORK_END} م`, [{ label: '🔙 الرئيسية' }]);
    }
  }

  if (session.step === 'name') {
    session.name = text.trim();
    session.step = 'age';
    sessions.set(from, session);
    return sendMessage(from, '📅 *اكتب سنك:*');
  }

  if (session.step === 'age') {
    const age = parseInt(text);
    if (isNaN(age) || age < 1 || age > 100) return sendMessage(from, '⚠️ *الرجاء إدخال سن صحيح (أرقام فقط).*');
    session.age = age;
    session.step = 'symptom';
    sessions.set(from, session);
    return sendMessage(from, '🩺 *اكتب شكوتك باختصار:*');
  }

  if (session.step === 'symptom') {
    session.symptom = text.trim();
    const tomorrow = getLocalDate();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    session.date = dateStr;
    session.step = 'select_slot';
    sessions.set(from, session);

    const slots = getAvailableSlots(dateStr);
    if (slots.length === 0) return sendMessage(from, '❌ *لا توجد مواعيد متاحة غداً.*\nجرب التواصل هاتفياً.', [{ label: '🔙 الرئيسية' }]);

    let msg = `📅 *المواعيد المتاحة غداً (${dateStr}):*\n`;
    slots.slice(0, 10).forEach((t, i) => { msg += `${i + 1}. ⏰ ${t}\n`; });
    msg += `\n*اكتب رقم الميعاد:*`;
    session.availableSlots = slots;
    sessions.set(from, session);
    return sendMessage(from, msg);
  }

  if (session.step === 'select_slot') {
    const choice = parseInt(text) - 1;
    const { availableSlots, date } = session;
    if (isNaN(choice) || choice < 0 || choice >= availableSlots.length) {
      return sendMessage(from, '⚠️ *اكتب رقم الميعاد من القائمة:*');
    }

    const selectedTime = availableSlots[choice];
    db.addAppointment({
      phone: from, name: session.name, age: session.age,
      symptom: session.symptom, date, time: selectedTime, status: 'confirmed'
    });

    sessions.delete(from);
    return sendMessage(from, `✅ *تم الحجز بنجاح!*\n👤 الاسم: ${session.name}\n📅 التاريخ: ${date}\n⏰ الساعة: ${selectedTime}\n💰 الكشف: ${process.env.CLINIC_FEE} ج.م\n📍 يرجى الحضور قبل الموعد بـ 10 دقائق.`, [{ label: '🔙 الرئيسية' }]);
  }
};

module.exports = { handleWebhook };
