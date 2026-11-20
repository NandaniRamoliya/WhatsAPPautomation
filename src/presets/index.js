// Business presets: one click in the setup wizard configures modules, settings,
// triage/lead questions and (optionally) realistic sample data for a business type.
// Prices are in minor units (paise). Add your own preset by copying one below.
import { run, insert, tx, get } from '../db/index.js';

const H = (from = '09:00', to = '21:00') => [[from, to]];
const split = [['10:00', '13:30'], ['17:00', '20:30']];
const week = (r, sun = []) => ({ mon: r, tue: r, wed: r, thu: r, fri: r, sat: r, sun });

const P = (name, category, price, unit = 'pc', description = '') => ({ name, category, price, unit, description });

export const PRESETS = {
  grocery: {
    label: 'Grocery / Kirana / Supermarket', icon: '🛒',
    description: 'Catalogue, cart, home delivery, UPI or cash on delivery, quick reorder.',
    examples: 'Kirana, supermarket, fruit & vegetable, dairy booth, dry fruits, meat & fish, gas agency, RO water',
    modules: ['ordering', 'enquiry'],
    settings: { hours: week(H('07:00', '22:00'), H('08:00', '13:00')), ordering: { delivery: true, pickup: true, delivery_fee: 2000, free_delivery_above: 30000, min_order: 10000, payment_modes: ['cod', 'upi'], eta_text: '30-45 minutes' } },
    sample: {
      products: [
        P('Aashirvaad Atta 5kg', 'Staples', 23000, 'pack'), P('Basmati Rice 1kg', 'Staples', 11000, 'kg'), P('Toor Dal 1kg', 'Staples', 16500, 'kg'),
        P('Sugar 1kg', 'Staples', 4600, 'kg'), P('Fortune Oil 1L', 'Oil & Ghee', 14000, 'bottle'), P('Amul Ghee 500ml', 'Oil & Ghee', 32000, 'pack'),
        P('Maggi 70g', 'Snacks', 1400, 'pack'), P('Parle-G', 'Snacks', 1000, 'pack'), P('Amul Milk 500ml', 'Dairy', 3300, 'pack'),
        P('Amul Butter 100g', 'Dairy', 6200, 'pack'), P('Bread', 'Dairy', 4500, 'pack'), P('Eggs (6)', 'Dairy', 4800, 'tray'),
      ],
      faqs: [
        { question: 'What are your delivery charges?', answer: 'Delivery is ₹20, and FREE on orders above ₹300. Minimum order ₹100.', keywords: 'delivery charge,delivery fee,free delivery' },
        { question: 'Which areas do you deliver to?', answer: 'We deliver within 3 km of the shop.', keywords: 'area,deliver to,location' },
      ],
    },
  },
  restaurant: {
    label: 'Restaurant / Cloud kitchen / Cafe', icon: '🍽️',
    description: 'Menu ordering, delivery or takeaway, online payment, kitchen status updates.',
    examples: 'Restaurant, cloud kitchen, cafe, bakery, sweet shop, tiffin service, juice shop, ice cream, catering',
    modules: ['ordering', 'enquiry'],
    settings: { hours: week(H('11:00', '23:00'), H('11:00', '23:00')), ordering: { delivery: true, pickup: true, delivery_fee: 3000, free_delivery_above: 50000, payment_modes: ['cod', 'upi', 'online'], eta_text: '35-45 minutes', ask_notes: true } },
    sample: {
      products: [
        P('Paneer Butter Masala', 'Main Course', 24000, 'plate'), P('Dal Makhani', 'Main Course', 19000, 'plate'), P('Veg Biryani', 'Rice', 21000, 'plate'),
        P('Butter Naan', 'Breads', 5000, 'pc'), P('Tandoori Roti', 'Breads', 2500, 'pc'), P('Gulab Jamun (2)', 'Desserts', 8000, 'plate'),
        P('Masala Chaas', 'Drinks', 6000, 'glass'), P('Veg Thali', 'Combos', 22000, 'thali', 'Dal, 2 sabzi, rice, 3 roti, salad'),
      ],
      faqs: [{ question: 'Do you do party orders?', answer: 'Yes! For 20+ people please send an enquiry and we will share a custom menu.', keywords: 'party,bulk,catering' }],
    },
  },
  bakery: {
    label: 'Bakery / Cake shop', icon: '🎂',
    description: 'Cake catalogue, advance orders with message notes, pickup or delivery.',
    examples: 'Bakery, cake shop, sweet shop, gift shop, flower shop',
    modules: ['ordering', 'enquiry'],
    settings: { hours: week(H('09:00', '21:30'), H('09:00', '21:30')), ordering: { delivery: true, pickup: true, delivery_fee: 4000, free_delivery_above: 100000, ask_notes: true, payment_modes: ['upi', 'cod'], eta_text: 'as per selected time' } },
    sample: {
      products: [P('Chocolate Truffle Cake', 'Cakes', 65000, '1 kg'), P('Black Forest Cake', 'Cakes', 55000, '1 kg'), P('Red Velvet Cake', 'Cakes', 75000, '1 kg'),
        P('Veg Puff', 'Snacks', 2500), P('Cookies Box', 'Cookies', 25000, 'box')],
      faqs: [{ question: 'Can you write a name on the cake?', answer: 'Yes! Add the message in "special instructions" while ordering.', keywords: 'name on cake,message,write' }],
    },
  },
  pharmacy: {
    label: 'Pharmacy / Medical store', icon: '💊',
    description: 'Reorder medicines, upload prescription photo, delivery and refill reminders.',
    examples: 'Pharmacy, medical store, optical store, pet shop',
    modules: ['ordering', 'enquiry'],
    settings: { hours: week(H('08:00', '22:30'), H('09:00', '14:00')), ordering: { delivery: true, pickup: true, accept_prescriptions: true, ask_notes: true, payment_modes: ['cod', 'upi'], eta_text: '1-2 hours' } },
    sample: {
      products: [P('Paracetamol 650 (15 tab)', 'Fever & Pain', 3500, 'strip'), P('ORS Sachet', 'Daily Care', 2200, 'sachet'), P('Vitamin C (Chewable)', 'Vitamins', 9900, 'bottle'),
        P('BP Monitor', 'Devices', 185000, 'pc'), P('N95 Mask', 'Daily Care', 6000)],
      faqs: [{ question: 'How do I order medicines with a prescription?', answer: 'Just send a clear photo of your prescription here. Our pharmacist will confirm the items and price.', keywords: 'prescription,medicine list,photo' }],
    },
  },
  clinic: {
    label: 'Clinic / Doctor / Diagnostic', icon: '🩺',
    description: 'Instant reply, triage questions, slot booking per doctor, reminders, aftercare, day-3 check-in, review request, recalls.',
    examples: 'Clinic, doctor, diagnostic centre, pathology lab, physiotherapy, veterinary, eye clinic',
    modules: ['booking', 'enquiry'],
    settings: {
      hours: week(split, []),
      booking: {
        staff_label: 'Doctor', slot_interval: 15, days_ahead: 7, min_notice_min: 60, checkin_days: 3,
        intake_questions: [
          { key: 'Problem', question: 'What is the main problem?', options: ['Fever / cold', 'Pain', 'Check-up'] },
          { key: 'Since', question: 'Since when?', options: ['Today', '2-3 days', 'More than a week'] },
        ],
      },
    },
    sample: {
      services: [
        { name: 'General Consultation', duration_min: 15, price: 50000, aftercare: 'Take medicines as prescribed. Drink plenty of water and rest.' },
        { name: 'Follow-up Visit', duration_min: 10, price: 30000 },
        { name: 'Full Body Check-up', duration_min: 45, price: 250000, recall_days: 365 },
      ],
      staff: [{ name: 'Dr. Mehta', title: 'General Physician' }, { name: 'Dr. Rao', title: 'General Physician' }],
      faqs: [
        { question: 'What are the consultation fees?', answer: 'Consultation ₹500, follow-up within 7 days ₹300.', keywords: 'fees,fee,charges,consultation fee' },
        { question: 'What are your timings?', answer: 'Mon–Sat 10:00–1:30 and 5:00–8:30. Sunday closed.', keywords: 'timing,time,open,hours' },
      ],
    },
  },
  dental: {
    label: 'Dental clinic', icon: '🦷',
    description: 'The full clinic playbook: toothache triage, booking, 24h + 2h reminders, prescriptions/aftercare, day-3 check-in, Google review, 6-month recall.',
    examples: 'Dental clinic, orthodontist, skin clinic, cosmetic clinic',
    modules: ['booking', 'enquiry'],
    settings: {
      hours: week(split, []),
      booking: {
        staff_label: 'Dentist', slot_interval: 30, days_ahead: 10, checkin_days: 3,
        intake_questions: [
          { key: 'Which tooth', question: 'Which tooth is troubling you?', options: ['Upper', 'Lower', 'Not sure'] },
          { key: 'Symptom', question: 'What are you feeling?', options: ['Pain', 'Swelling', 'Sensitivity'] },
          { key: 'Since', question: 'Since when?', options: ['Today', '2-3 days', 'Over a week'] },
        ],
      },
    },
    sample: {
      services: [
        { name: 'Toothache / Emergency', duration_min: 30, price: 50000, aftercare: 'Avoid very hot or cold food for 24 hours. Take medicines as prescribed.' },
        { name: 'Cleaning & Scaling', duration_min: 45, price: 120000, recall_days: 180, aftercare: 'Mild sensitivity for 1-2 days is normal. Use a soft brush.' },
        { name: 'Root Canal (sitting)', duration_min: 60, price: 400000, aftercare: 'Do not chew on the treated side until the crown is fitted.' },
        { name: 'Braces Adjustment', duration_min: 30, price: 80000, recall_days: 30 },
        { name: 'Consultation', duration_min: 20, price: 30000 },
      ],
      staff: [{ name: 'Dr. Mehta', title: 'Dentist' }],
      faqs: [
        { question: 'How much does a root canal cost?', answer: 'Root canal treatment starts at ₹4,000 per sitting. Exact cost after X-ray.', keywords: 'root canal,rct,cost' },
        { question: 'Is parking available?', answer: 'Yes, free parking is available in front of the clinic.', keywords: 'parking' },
      ],
    },
  },
  salon: {
    label: 'Salon / Spa / Beauty parlour', icon: '💇',
    description: 'Service menu with prices, stylist choice, slot booking, reminders, rebooking.',
    examples: 'Salon, barber, beauty parlour, spa, nail studio, tattoo studio, pet grooming',
    modules: ['booking', 'enquiry'],
    settings: { hours: week(H('10:00', '20:30'), H('10:00', '20:30')), booking: { staff_label: 'Stylist', slot_interval: 30, days_ahead: 7, checkin_days: 0 } },
    sample: {
      services: [
        { name: 'Haircut (Men)', duration_min: 30, price: 30000, recall_days: 30, category: 'Hair' },
        { name: 'Haircut (Women)', duration_min: 45, price: 60000, recall_days: 45, category: 'Hair' },
        { name: 'Hair Colour', duration_min: 90, price: 150000, category: 'Hair' },
        { name: 'Facial', duration_min: 60, price: 120000, recall_days: 30, category: 'Skin' },
        { name: 'Manicure & Pedicure', duration_min: 60, price: 90000, category: 'Hands & Feet' },
      ],
      staff: [{ name: 'Priya', title: 'Senior Stylist' }, { name: 'Aman', title: 'Stylist' }],
      faqs: [{ question: 'Do you accept walk-ins?', answer: 'Yes, but booked customers get priority. Book here to skip the wait!', keywords: 'walk in,walkin,without appointment' }],
    },
  },
  fitness: {
    label: 'Gym / Yoga / Fitness studio', icon: '🏋️',
    description: 'Trial class booking, class slots, membership enquiries, renewal recalls.',
    examples: 'Gym, yoga studio, dance class, music class, swimming, sports academy',
    modules: ['booking', 'enquiry'],
    settings: {
      hours: week([['06:00', '10:00'], ['17:00', '21:00']], H('07:00', '10:00')),
      booking: { staff_label: 'Trainer', slot_interval: 60, days_ahead: 7, checkin_days: 2, review_request: true },
      enquiry: { lead_questions: [{ key: 'Goal', question: 'What is your fitness goal?', options: ['Weight loss', 'Muscle gain', 'General fitness'] }, { key: 'Preferred time', question: 'Preferred time?', options: ['Morning', 'Evening'] }] },
    },
    sample: {
      services: [{ name: 'Free Trial Class', duration_min: 60, price: 0 }, { name: 'Personal Training Session', duration_min: 60, price: 80000 }, { name: 'Yoga Class', duration_min: 60, price: 30000 }],
      staff: [{ name: 'Rohit', title: 'Head Coach' }],
      faqs: [{ question: 'What are the membership plans?', answer: 'Monthly ₹1,500 · Quarterly ₹4,000 · Yearly ₹12,000. Free trial available!', keywords: 'membership,plan,fees,price' }],
    },
  },
  coaching: {
    label: 'Coaching / Tuition / School', icon: '🎓',
    description: 'Admission enquiries, demo class booking, batch timings, fee FAQs.',
    examples: 'Coaching centre, tuition, school, driving school, computer institute, library',
    modules: ['booking', 'enquiry'],
    settings: {
      hours: week(H('09:00', '19:00'), []),
      booking: { staff_label: 'Counsellor', slot_interval: 30, checkin_days: 0, review_request: false },
      enquiry: { lead_questions: [
        { key: 'Student name', question: 'Student\'s name?', options: [] },
        { key: 'Class', question: 'Which class / course?', options: [] },
        { key: 'Mode', question: 'Preferred mode?', options: ['Offline', 'Online'] },
      ] },
    },
    sample: {
      services: [{ name: 'Free Demo Class', duration_min: 60, price: 0 }, { name: 'Counselling Session', duration_min: 30, price: 0 }],
      staff: [{ name: 'Admissions Desk', title: 'Counsellor' }],
      faqs: [{ question: 'What are the batch timings?', answer: 'Morning 7–9 AM, Evening 5–7 PM, Weekend batches available.', keywords: 'batch,timing,schedule' }],
    },
  },
  home_services: {
    label: 'Home services / Repair', icon: '🔧',
    description: 'Service booking with visit slot, address capture via enquiry, job status, AMC reminders.',
    examples: 'AC repair, plumber, electrician, carpenter, pest control, cleaning, mobile repair, car/bike service, laundry',
    modules: ['booking', 'enquiry'],
    settings: {
      hours: week(H('09:00', '19:00'), H('10:00', '14:00')),
      booking: { staff_label: 'Technician', slot_interval: 120, days_ahead: 5, allow_staff_choice: false, checkin_days: 2,
        intake_questions: [{ key: 'Address', question: 'Please type the full service address.', options: [] }, { key: 'Problem', question: 'Describe the problem in a few words.', options: [] }] },
    },
    sample: {
      services: [{ name: 'AC Service', duration_min: 120, price: 59900, recall_days: 180 }, { name: 'AC Repair (inspection)', duration_min: 120, price: 29900 }, { name: 'Plumbing Visit', duration_min: 120, price: 19900 }],
      staff: [{ name: 'Technician Team A', title: 'Technician' }, { name: 'Technician Team B', title: 'Technician' }],
      faqs: [{ question: 'Is there a visiting charge?', answer: 'Inspection/visit charge is ₹299, adjusted in the final bill if you go ahead with the repair.', keywords: 'visit charge,visiting,inspection' }],
    },
  },
  real_estate: {
    label: 'Real estate / Lead generation', icon: '🏠',
    description: 'Qualify leads with questions, site visit booking, owner alerts.',
    examples: 'Real estate broker, builder, interior designer, travel agent, insurance, CA, lawyer, wedding planner',
    modules: ['booking', 'enquiry'],
    settings: {
      hours: week(H('10:00', '19:00'), H('11:00', '17:00')),
      booking: { staff_label: 'Agent', slot_interval: 60, days_ahead: 10, checkin_days: 0, review_request: false },
      enquiry: { lead_questions: [
        { key: 'Looking for', question: 'What are you looking for?', options: ['Buy', 'Rent', 'Sell'] },
        { key: 'Type', question: 'Property type?', options: ['Flat', 'House / Villa', 'Plot / Commercial'] },
        { key: 'Budget', question: 'Your budget? (e.g. 50 lakh)', options: [] },
        { key: 'Location', question: 'Preferred location?', options: [] },
      ] },
    },
    sample: {
      services: [{ name: 'Site Visit', duration_min: 60, price: 0 }, { name: 'Office Consultation', duration_min: 30, price: 0 }],
      staff: [{ name: 'Sales Team', title: 'Agent' }],
      faqs: [{ question: 'Do you charge brokerage?', answer: 'Brokerage is 1% for buyers and one month rent for rentals.', keywords: 'brokerage,commission' }],
    },
  },
  generic: {
    label: 'Other / Custom', icon: '✨',
    description: 'FAQs, enquiry capture and human handoff. Turn on ordering or booking anytime.',
    examples: 'Any business - start here and switch modules on later',
    modules: ['enquiry'],
    settings: {},
    sample: {
      faqs: [
        { question: 'What are your timings?', answer: 'We are open Monday to Saturday, 9 AM to 9 PM.', keywords: 'timing,open,hours,time' },
        { question: 'Where are you located?', answer: 'Please see our address and map link in our WhatsApp profile.', keywords: 'address,location,where' },
      ],
    },
  },
};

/** Public list for the setup wizard. */
export const presetList = () => Object.entries(PRESETS).map(([key, p]) => ({ key, label: p.label, icon: p.icon, description: p.description, examples: p.examples, modules: p.modules }));

/** Insert sample products/services/staff/FAQs for a preset (skips tables that already have data). */
export function loadSampleData(bizId, presetKey) {
  const p = PRESETS[presetKey];
  if (!p?.sample) return;
  tx(() => {
    const empty = (table) => !get(`SELECT 1 FROM ${table} WHERE business_id = ? LIMIT 1`, bizId);
    if (p.sample.products && empty('products')) {
      p.sample.products.forEach((x, i) => insert('products', { business_id: bizId, ...x, sort: i }));
    }
    if (p.sample.services && empty('services')) {
      p.sample.services.forEach((x, i) => insert('services', { business_id: bizId, ...x, sort: i }));
    }
    if (p.sample.staff && empty('staff')) {
      p.sample.staff.forEach((x, i) => insert('staff', { business_id: bizId, ...x, sort: i }));
    }
    if (p.sample.faqs && empty('faqs')) {
      p.sample.faqs.forEach((x, i) => insert('faqs', { business_id: bizId, ...x, sort: i }));
    }
  });
}

export function clearSampleData(bizId) {
  for (const t of ['products', 'services', 'staff', 'faqs']) run(`DELETE FROM ${t} WHERE business_id = ?`, bizId);
}
