import { db } from 'hatchable';

export const access = 'user';
export const methods = ['GET'];

export default async function (req, res) {
  const centreId = Number(req.query && req.query.centre_id);
  const date = String(req.query && req.query.date || '');
  if (!Number.isSafeInteger(centreId) || centreId < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(422).json({ error: 'Choose a valid centre and date.' });
  try {
    const result = await db.query('SELECT * FROM procurement_centres WHERE id=$1 AND is_active=true', [centreId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Centre not found.' });
    const c = result.rows[0];
    const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(date + 'T12:00:00Z').getUTCDay()];
    if (!(c.operating_days || []).includes(dayName)) return res.json({ slots: [], closed: true, message: 'This centre is closed on the selected day.' });
    const loadResult = await db.query(
      "SELECT slot_start,count(*) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW'))::int AS farmers,COALESCE(sum(quantity_kg) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW')),0)::numeric AS kg,count(*) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW') AND is_emergency)::int AS emergency_farmers,COALESCE(sum(quantity_kg) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW') AND is_emergency),0)::numeric AS emergency_kg FROM bookings WHERE centre_id=$1 AND procurement_date=$2::date GROUP BY slot_start",
      [centreId,date]
    );
    const dayResult = await db.query(
      "SELECT count(*) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW'))::int AS farmers,COALESCE(sum(quantity_kg) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW')),0)::numeric AS kg,count(*) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW') AND is_emergency)::int AS emergency_farmers,COALESCE(sum(quantity_kg) FILTER (WHERE status NOT IN ('CANCELLED','NO_SHOW') AND is_emergency),0)::numeric AS emergency_kg FROM bookings WHERE centre_id=$1 AND procurement_date=$2::date",
      [centreId,date]
    );
    const bySlot = {};
    for (const row of loadResult.rows) bySlot[String(row.slot_start).slice(0,5)] = row;
    const day = dayResult.rows[0];
    const toMinutes = v => { const a=String(v).slice(0,5).split(':').map(Number); return a[0]*60+a[1]; };
    const time = n => String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
    const slots = [];
    const open = toMinutes(c.opening_time), close = toMinutes(c.closing_time), duration=Number(c.slot_duration_minutes);
    for (let start=open; start+duration<=close; start+=duration) {
      const key=time(start), row=bySlot[key] || {farmers:0,kg:0};
      const regularAvailable = Number(day.farmers)<Number(c.max_farmers_day) && Number(day.kg)<Number(c.max_quantity_kg_day)-Number(c.emergency_reserved_kg) && Number(row.farmers)<Number(c.max_farmers_slot) && Number(row.kg)<Number(c.max_quantity_kg_slot);
      const emergencyPossible = Number(day.farmers)<Number(c.max_farmers_day) && Number(day.kg)<Number(c.max_quantity_kg_day) && Number(day.emergency_farmers)<Number(c.emergency_max_farmers_day) && Number(day.emergency_kg)<Number(c.emergency_reserved_kg);
      slots.push({start:key,end:time(start+duration),available:regularAvailable,emergency_possible:emergencyPossible,booked_farmers:Number(row.farmers),booked_kg:Number(row.kg),remaining_farmers:Math.max(0,Number(c.max_farmers_slot)-Number(row.farmers)),remaining_kg:Math.max(0,Number(c.max_quantity_kg_slot)-Number(row.kg))});
    }
    return res.json({slots,centre_id:centreId,date,closed:false});
  } catch (e) {
    return res.status(500).json({ error: 'Slot availability could not be loaded.' });
  }
}