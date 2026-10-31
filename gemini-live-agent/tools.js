/**
 * Domain Tools for Gemini Live Real-Time Voice Agent
 * Non-blocking tool declarations & asynchronous executors.
 */

let db = null;
try {
  db = require('../backend/db');
} catch (e) {
  console.warn('[Tools] backend/db not loaded, falling back to in-memory store:', e.message);
}

// In-memory fallback dataset in case db is not initialized
const FALLBACK_EVENTS = [
  {
    title: 'ECHOES OF ASIA WORLD TOUR 2026',
    venue: 'อิมแพ็ค อารีน่า เมืองทองธานี',
    date: '14 - 15 พ.ย. 2026',
    priceRange: '1,800 - 6,500 THB',
    remainingVip: 50,
    remainingA: 100,
    remainingB: 120,
    remainingC: 150
  },
  {
    title: 'K-POP FESTIVAL LIVE IN BKK 2026',
    venue: 'ราชมังคลากีฬาสถาน',
    date: '28 พ.ย. 2026',
    priceRange: '2,200 - 7,000 THB',
    remainingVip: 40,
    remainingA: 80,
    remainingB: 100,
    remainingC: 140
  },
  {
    title: 'THAI ROCK REVOLUTION 2026',
    venue: 'ไบเทค บางนา (Hall 100)',
    date: '5 ธ.ค. 2026',
    priceRange: '1,200 - 3,500 THB',
    remainingVip: 45,
    remainingA: 90,
    remainingB: 110,
    remainingC: 150
  }
];

/**
 * Tool Declarations for Gemini Live API
 * CRITICAL: behavior: "NON_BLOCKING" enables the model to speak conversational
 * fillers and stream audio while tools execute asynchronously in the background.
 */
const TOOL_DECLARATIONS = [
  {
    name: 'check_ticket_availability',
    description: 'Checks real-time concert ticket availability, remaining seats per zone, venue, and date. Use when a customer inquires about concerts, remaining tickets, or seating zones.',
    behavior: 'NON_BLOCKING',
    parameters: {
      type: 'OBJECT',
      properties: {
        event_name: {
          type: 'STRING',
          description: 'Name or keywords of the concert or artist (e.g. Echoes of Asia, K-Pop, Thai Rock)'
        },
        zone: {
          type: 'STRING',
          description: 'Optional seating zone: VIP, Zone A, Zone B, or Zone C'
        }
      },
      required: ['event_name']
    }
  },
  {
    name: 'calculate_booking_quote',
    description: 'Calculates the complete price breakdown for ticket reservations, including subtotal, promotional discounts, and 7% VAT. Use when a customer wants to know the total price for a specific number of tickets or mentions a promo code.',
    behavior: 'NON_BLOCKING',
    parameters: {
      type: 'OBJECT',
      properties: {
        event_name: {
          type: 'STRING',
          description: 'Name of the concert'
        },
        zone: {
          type: 'STRING',
          description: 'Selected zone: VIP, Zone A, Zone B, or Zone C'
        },
        ticket_count: {
          type: 'INTEGER',
          description: 'Number of tickets to reserve (1 to 6)'
        },
        promo_code: {
          type: 'STRING',
          description: 'Optional promo or discount code provided by the user'
        }
      },
      required: ['event_name', 'zone', 'ticket_count']
    }
  },
  {
    name: 'lookup_reservation_status',
    description: 'Looks up the reservation and payment status for an existing order by reference number. Use when a customer asks to track their order status or ticket QR code.',
    behavior: 'NON_BLOCKING',
    parameters: {
      type: 'OBJECT',
      properties: {
        order_ref: {
          type: 'STRING',
          description: 'The order reference number (e.g. TKT-2026-XXXX)'
        }
      },
      required: ['order_ref']
    }
  }
];

/**
 * Asynchronous tool executor
 * Simulates real-world API/database latency (500-1200ms) to demonstrate
 * non-blocking conversational fillers streamed by Gemini Live.
 */
async function executeTool(name, args) {
  const startTime = Date.now();
  console.log(`[Tool Call Started] ${name}:`, JSON.stringify(args));

  // Simulate network or database query latency
  await new Promise(r => setTimeout(r, 600));

  let result = null;

  switch (name) {
    case 'check_ticket_availability': {
      const q = (args.event_name || '').toLowerCase();
      let events = [];
      if (db && typeof db.listEventsWithQuota === 'function') {
        events = db.listEventsWithQuota();
      } else {
        events = FALLBACK_EVENTS;
      }

      const matched = events.find(e =>
        e.title.toLowerCase().includes(q) ||
        (e.venue && e.venue.toLowerCase().includes(q))
      ) || events[0];

      result = {
        event_name: matched.title,
        date: matched.date,
        venue: matched.venue,
        price_range: matched.priceRange || '1,800 - 6,500 THB',
        requested_zone: args.zone || 'ALL',
        zones: {
          VIP: { remaining: matched.remainingVip ?? 50, price: 6500, status: 'AVAILABLE' },
          Zone_A: { remaining: matched.remainingA ?? 100, price: 4500, status: 'AVAILABLE' },
          Zone_B: { remaining: matched.remainingB ?? 120, price: 3000, status: 'AVAILABLE' },
          Zone_C: { remaining: matched.remainingC ?? 150, price: 1800, status: 'AVAILABLE' }
        },
        notice: 'Maximum 6 tickets per transaction. E-tickets delivered instantly via LINE and QR code.'
      };
      break;
    }

    case 'calculate_booking_quote': {
      const count = Math.max(1, Math.min(6, Number(args.ticket_count) || 1));
      const zoneKey = (args.zone || 'Zone A').toUpperCase();
      let unitPrice = 4500;
      if (zoneKey.includes('VIP')) unitPrice = 6500;
      else if (zoneKey.includes('B')) unitPrice = 3000;
      else if (zoneKey.includes('C')) unitPrice = 1800;

      const subtotal = unitPrice * count;
      let discountAmount = 0;
      let promoApplied = null;

      if (args.promo_code) {
        const code = args.promo_code.toUpperCase().trim();
        if (db && typeof db.validatePromoCode === 'function') {
          const promoRes = db.validatePromoCode(code, subtotal);
          if (promoRes.valid) {
            discountAmount = promoRes.discountAmount;
            promoApplied = promoRes.promo;
          }
        } else if (code === 'EARLYBIRD' || code === 'LIGHT2026') {
          discountAmount = Math.round(subtotal * 0.15);
          promoApplied = { code, discountPercent: 15 };
        }
      }

      const discountedSubtotal = subtotal - discountAmount;
      const vatAmount = Math.round(discountedSubtotal * 0.07);
      const totalAmount = discountedSubtotal + vatAmount;

      result = {
        event_name: args.event_name,
        zone: args.zone,
        ticket_count: count,
        unit_price_thb: unitPrice,
        subtotal_thb: subtotal,
        promo_code: args.promo_code || null,
        discount_thb: discountAmount,
        vat_7_percent_thb: vatAmount,
        final_total_thb: totalAmount,
        payment_methods: ['PromptPay QR', 'Credit/Debit Card', 'Mobile Banking']
      };
      break;
    }

    case 'lookup_reservation_status': {
      const ref = (args.order_ref || '').trim();
      let order = null;
      if (db && typeof db.getOrder === 'function') {
        order = db.getOrder(ref);
      }

      if (order) {
        result = {
          found: true,
          ref: order.ref,
          event_name: order.title,
          zone: order.zone,
          qty: order.qty,
          total_thb: order.total,
          status: order.status,
          holder_name: order.holder_name,
          checked_in: Boolean(order.checked_in_at)
        };
      } else {
        result = {
          found: false,
          ref: ref,
          message: 'Order reference not found. Please double check the ref code or contact customer support.'
        };
      }
      break;
    }

    default:
      result = { error: `Unknown tool function: ${name}` };
  }

  const durationMs = Date.now() - startTime;
  console.log(`[Tool Call Completed] ${name} in ${durationMs}ms:`, JSON.stringify(result));
  return { result, execution_time_ms: durationMs };
}

module.exports = {
  TOOL_DECLARATIONS,
  executeTool
};
