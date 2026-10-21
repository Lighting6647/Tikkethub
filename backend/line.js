/**
 * LINE Official Account (Messaging API) integration:
 * 1. Push E-Ticket Flex Message when Admin approves a slip (`/v2/bot/message/push`)
 * 2. Webhook Auto-Reply when a customer messages or follows the LINE OA (`/v2/bot/message/reply`)
 *    returning their `LINE User ID` so they can link it in 1 click on the booking form.
 */

function buildTicketFlexMessage(order) {
  const qrPayload = order.qrPayload || ('THAITICKET|' + order.ref + '|' + (order.zone || '') + '|' + (order.qty || 1) + (order.qrSignature ? '|SIG:' + order.qrSignature : ''));
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=12&data=${encodeURIComponent(qrPayload)}`;
  const ticketPassUrl = `https://tikkethub.vercel.app/ticket.html?ref=${encodeURIComponent(order.ref)}`;

  return {
    type: 'flex',
    altText: `บัตรคอนเสิร์ต ${order.title} (${order.ref}) อนุมัติแล้ว พร้อม QR Code สแกนเข้างาน`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1E1E1E',
        paddingAll: '20px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'text',
                text: 'THAI TICKET',
                color: '#B40000',
                weight: 'bold',
                size: 'sm'
              },
              {
                type: 'text',
                text: 'OFFICIAL E-TICKET',
                color: '#229BFF',
                weight: 'bold',
                size: 'xs',
                align: 'end'
              }
            ]
          },
          {
            type: 'text',
            text: order.title,
            color: '#FFFFFF',
            weight: 'bold',
            size: 'lg',
            wrap: true,
            margin: 'md'
          },
          {
            type: 'text',
            text: `${order.date} · ${order.venue}`,
            color: '#CCCCCC',
            size: 'xs',
            wrap: true,
            margin: 'sm'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#262626',
        paddingAll: '20px',
        spacing: 'md',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  { type: 'text', text: 'ผู้ถือบัตร', color: '#999999', size: 'xs' },
                  { type: 'text', text: order.holderName, color: '#FFFFFF', weight: 'bold', size: 'sm', wrap: true }
                ]
              },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  { type: 'text', text: 'เบอร์โทรศัพท์', color: '#999999', size: 'xs' },
                  { type: 'text', text: order.holderPhone, color: '#FFFFFF', weight: 'bold', size: 'sm' }
                ]
              }
            ]
          },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  { type: 'text', text: 'โซนที่นั่ง', color: '#999999', size: 'xs' },
                  { type: 'text', text: order.zone, color: '#FFFFFF', weight: 'bold', size: 'sm' }
                ]
              },
              {
                type: 'box',
                layout: 'vertical',
                contents: [
                  { type: 'text', text: 'จำนวน / ยอดชำระ', color: '#999999', size: 'xs' },
                  {
                    type: 'text',
                    text: `${order.qty} ใบ (${Number(order.total).toLocaleString('th-TH')} THB)`,
                    color: '#229BFF',
                    weight: 'bold',
                    size: 'sm'
                  }
                ]
              }
            ]
          },
          {
            type: 'separator',
            color: '#444444',
            margin: 'md'
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            alignItems: 'center',
            contents: [
              { type: 'text', text: 'รหัสการจองบัตร (Booking Ref)', color: '#999999', size: 'xs' },
              { type: 'text', text: order.ref, color: '#FFFFFF', weight: 'bold', size: 'xl', margin: 'xs' },
              { type: 'text', text: '🟢 ชำระเงิน & อนุมัติสิทธิ์เรียบร้อย', color: '#68D391', size: 'xs', margin: 'xs', weight: 'bold' }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            alignItems: 'center',
            backgroundColor: '#1E1E1E',
            cornerRadius: '12px',
            paddingAll: '16px',
            contents: [
              {
                type: 'image',
                url: qrUrl,
                size: 'lg',
                aspectRatio: '1:1',
                aspectMode: 'cover'
              },
              {
                type: 'text',
                text: '📷 ยื่น QR Code นี้ที่จุดตรวจเพื่อสแกนเข้างาน',
                color: '#68D391',
                size: 'xs',
                weight: 'bold',
                align: 'center',
                margin: 'md'
              },
              {
                type: 'text',
                text: '🔐 ลายเซ็นดิจิทัล HMAC-SHA256 ป้องกันบัตรปลอม',
                color: '#888888',
                size: 'xxs',
                align: 'center',
                margin: 'xs'
              }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1E1E1E',
        paddingAll: '16px',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#B40000',
            height: 'sm',
            action: {
              type: 'uri',
              label: '🎫 เปิดดูบัตรจริง & Dynamic Pass',
              uri: ticketPassUrl
            }
          }
        ]
      }
    }
  };
}

async function sendLineTicketPush(order, channelAccessToken) {
  const flex = buildTicketFlexMessage(order);
  const to = String(order.lineUserId || '').trim();
  const token = String(channelAccessToken || '').trim();

  if (!token || !/^U[0-9a-fA-F]{32}$/.test(to)) {
    return {
      sentMode: 2,
      message: !token
        ? 'สร้างข้อความบัตร LINE Flex Message สำเร็จ (โหมดจำลอง — ตั้งค่า Channel Access Token ในหน้าแอดมินเพื่อยิงเข้า LINE จริง)'
        : 'สร้างข้อความบัตร LINE Flex Message สำเร็จ (โหมดจำลอง — รหัส LINE User ID สำหรับยิงจริงต้องขึ้นต้นด้วย U ตามด้วยรหัส 32 ตัวอักษร)',
      payload: { to: to || '(ไม่ได้ระบุ LINE User ID)', messages: [flex] },
      sentAt: Date.now()
    };
  }

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        to,
        messages: [flex]
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        sentMode: 2,
        message: `ส่งผ่าน LINE API ไม่สำเร็จ (${res.status}) บันทึกเป็นพรีวิวแทน`,
        apiError: errText.slice(0, 300),
        payload: { to, messages: [flex] },
        sentAt: Date.now()
      };
    }

    return {
      sentMode: 1,
      message: 'ส่งบัตรเข้า LINE Official Account สำเร็จแล้ว',
      payload: { to, messages: [flex] },
      sentAt: Date.now()
    };
  } catch (err) {
    return {
      sentMode: 2,
      message: `ไม่สามารถเชื่อมต่อ LINE API (${err.message}) บันทึกเป็นพรีวิวแทน`,
      payload: { to, messages: [flex] },
      sentAt: Date.now()
    };
  }
}

function buildWebhookReplyMessages(userId) {
  return [
    {
      type: 'text',
      text: `สวัสดีครับ! รหัส LINE User ID ของคุณสำหรับรับบัตรคอนเสิร์ตคือ:\n${userId}\n\nคัดลอกรหัสนี้ไปวางในช่อง LINE User ID บนหน้าจองบัตร หรือกดปุ่ม "ดึงรหัส LINE อัตโนมัติ" ได้เลยครับ`
    }
  ];
}

async function replyLineWebhook(replyToken, userId, channelAccessToken) {
  const messages = buildWebhookReplyMessages(userId);
  const token = String(channelAccessToken || '').trim();
  if (!token || !replyToken || replyToken === 'SIMULATED_REPLY_TOKEN') {
    return { replied: false, simulated: true, messages };
  }
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ replyToken, messages })
    });
    return { replied: res.ok, status: res.status, messages };
  } catch (err) {
    return { replied: false, error: err.message, messages };
  }
}

async function sendAdminNewOrderNotification(channelAccessToken, adminUserId, order) {
  const token = String(channelAccessToken || '').trim();
  const to = String(adminUserId || '').trim();
  if (!token || !to) {
    return { ok: false, error: 'ยังไม่ได้ตั้งค่า LINE Token หรือ Admin LINE User ID' };
  }

  const flexMsg = {
    type: 'flex',
    altText: `🔔 มีคำสั่งซื้อใหม่ (${order.ref}) · ยอด ${Number(order.total).toLocaleString('th-TH')} THB`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#B40000',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: '🔔 รายการสั่งซื้อใหม่รอตรวจสลิป',
            color: '#FFFFFF',
            weight: 'bold',
            size: 'md'
          },
          {
            type: 'text',
            text: `รหัส: ${order.ref}`,
            color: '#FFCCCC',
            size: 'xs',
            margin: 'xs'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1E1E1E',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: order.title,
            color: '#FFFFFF',
            weight: 'bold',
            size: 'sm',
            wrap: true
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            spacing: 'xs',
            contents: [
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  { type: 'text', text: 'ผู้สั่งซื้อ:', color: '#999999', size: 'xs', flex: 2 },
                  { type: 'text', text: order.holderName || '-', color: '#FFFFFF', size: 'xs', flex: 4, weight: 'bold' }
                ]
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  { type: 'text', text: 'เบอร์โทร:', color: '#999999', size: 'xs', flex: 2 },
                  { type: 'text', text: order.holderPhone || '-', color: '#FFFFFF', size: 'xs', flex: 4 }
                ]
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  { type: 'text', text: 'โซน/ที่นั่ง:', color: '#999999', size: 'xs', flex: 2 },
                  { type: 'text', text: `${order.zone || ''} (${order.qty || 1} ใบ)`, color: '#FFFFFF', size: 'xs', flex: 4 }
                ]
              },
              {
                type: 'box',
                layout: 'horizontal',
                contents: [
                  { type: 'text', text: 'ยอดโอน:', color: '#999999', size: 'xs', flex: 2 },
                  { type: 'text', text: `${Number(order.total).toLocaleString('th-TH')} THB`, color: '#68D391', size: 'sm', flex: 4, weight: 'bold' }
                ]
              }
            ]
          }
        ]
      }
    }
  };

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        to,
        messages: [flexMsg]
      })
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data: json };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  buildTicketFlexMessage,
  sendLineTicketPush,
  sendAdminNewOrderNotification,
  buildWebhookReplyMessages,
  replyLineWebhook
};

