/**
 * LINE Official Account (Messaging API) integration:
 * 1. Push E-Ticket Flex Message when Admin approves a slip (`/v2/bot/message/push`)
 * 2. Webhook Auto-Reply when a customer messages or follows the LINE OA (`/v2/bot/message/reply`)
 *    returning their `LINE User ID` so they can link it in 1 click on the booking form.
 */

function buildTicketFlexMessage(order) {
  return {
    type: 'flex',
    altText: `บัตรคอนเสิร์ต ${order.title} (${order.ref}) อนุมัติแล้ว`,
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
                text: 'E-TICKET',
                color: '#229BFF',
                weight: 'bold',
                size: 'sm',
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
        backgroundColor: '#333333',
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
            color: '#555555',
            margin: 'lg'
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'lg',
            alignItems: 'center',
            contents: [
              { type: 'text', text: 'รหัสการจอง (แสดงหน้างาน)', color: '#999999', size: 'xs' },
              { type: 'text', text: order.ref, color: '#FFFFFF', weight: 'bold', size: 'xl', margin: 'xs' },
              { type: 'text', text: 'สถานะ: ชำระเงินและอนุมัติแล้ว', color: '#229BFF', size: 'xs', margin: 'sm' }
            ]
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

module.exports = {
  buildTicketFlexMessage,
  sendLineTicketPush,
  buildWebhookReplyMessages,
  replyLineWebhook
};
