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

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASE_URL = process.env.PUBLIC_BASE_URL || 'https://tikkethub.vercel.app';

const RICH_MENU_TEMPLATES = {
  large_6grid: {
    key: 'large_6grid',
    title: 'แบบเต็มจอ 6 ปุ่ม (Large 2500×1686 · ครบทุกฟังก์ชัน)',
    badge: 'แนะนำ (6 ปุ่ม)',
    size: { width: 2500, height: 1686 },
    chatBarText: '🎫 เมนูจองบัตร & รับ E-Ticket',
    previewImage: '/rich-menu/rich-menu-large-1200x810.jpg',
    fileJpg: 'rich-menu-large-2500x1686.jpg',
    filePng: 'rich-menu-large-1200x810.png',
    buildAreas(baseUrl) {
      const base = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
      const colW = 833;
      const rowH = 843;
      return [
        {
          bounds: { x: 0, y: 0, width: colW, height: rowH },
          action: { type: 'uri', label: 'จองบัตร / เลือกโต๊ะ', uri: `${base}/` }
        },
        {
          bounds: { x: colW, y: 0, width: colW, height: rowH },
          action: { type: 'message', label: 'ขอรหัส LINE ID', text: 'บัตร' }
        },
        {
          bounds: { x: colW * 2, y: 0, width: 2500 - colW * 2, height: rowH },
          action: { type: 'uri', label: 'บัตร E-Ticket ของฉัน', uri: `${base}/?action=my-tickets` }
        },
        {
          bounds: { x: 0, y: rowH, width: colW, height: rowH },
          action: { type: 'uri', label: 'ผังที่นั่ง & โซนราคา', uri: `${base}/#eventsSection` }
        },
        {
          bounds: { x: colW, y: rowH, width: colW, height: rowH },
          action: { type: 'message', label: 'ชำระเงิน & แนบสลิป', text: 'วิธีชำระเงิน' }
        },
        {
          bounds: { x: colW * 2, y: rowH, width: 2500 - colW * 2, height: rowH },
          action: { type: 'message', label: 'ติดต่อแอดมิน 24 ชม.', text: 'ติดต่อแอดมิน' }
        }
      ];
    }
  },
  small_3grid: {
    key: 'small_3grid',
    title: 'แบบครึ่งจอ 3 ปุ่ม (Compact 2500×843 · จองบัตร / ขอ LINE ID / ดูบัตร)',
    badge: 'กะทัดรัด (3 ปุ่ม)',
    size: { width: 2500, height: 843 },
    chatBarText: '🎫 จองบัตร / ขอรหัส LINE ID',
    previewImage: '/rich-menu/rich-menu-small-1200x405.jpg',
    fileJpg: 'rich-menu-small-2500x843.jpg',
    filePng: 'rich-menu-small-1200x405.png',
    buildAreas(baseUrl) {
      const base = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
      const colW = 833;
      return [
        {
          bounds: { x: 0, y: 0, width: colW, height: 843 },
          action: { type: 'uri', label: 'จองบัตรคอนเสิร์ต', uri: `${base}/` }
        },
        {
          bounds: { x: colW, y: 0, width: colW, height: 843 },
          action: { type: 'message', label: 'ขอรหัส LINE ID', text: 'บัตร' }
        },
        {
          bounds: { x: colW * 2, y: 0, width: 2500 - colW * 2, height: 843 },
          action: { type: 'uri', label: 'ดูบัตร / ติดต่อเรา', uri: `${base}/?action=my-tickets` }
        }
      ];
    }
  },
  small_2grid: {
    key: 'small_2grid',
    title: 'แบบครึ่งจอ 2 ปุ่มใหญ่ (Split 2500×843 · จองบัตร + ขอรหัส LINE ID)',
    badge: 'ชัดเจน (2 ปุ่ม)',
    size: { width: 2500, height: 843 },
    chatBarText: '🎫 จองบัตร & รับรหัส LINE ID',
    previewImage: '/rich-menu/rich-menu-small-2grid-2500x843.jpg',
    fileJpg: 'rich-menu-small-2grid-2500x843.jpg',
    filePng: 'rich-menu-small-2grid-2500x843.png',
    buildAreas(baseUrl) {
      const base = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
      return [
        {
          bounds: { x: 0, y: 0, width: 1250, height: 843 },
          action: { type: 'uri', label: 'จองบัตรคอนเสิร์ต & โต๊ะ VIP', uri: `${base}/` }
        },
        {
          bounds: { x: 1250, y: 0, width: 1250, height: 843 },
          action: { type: 'message', label: 'ขอรหัส LINE ID รับบัตร', text: 'บัตร' }
        }
      ];
    }
  },
  small_1banner: {
    key: 'small_1banner',
    title: 'แบบแบนเนอร์เดียว (Hero Banner 2500×843 · แตะซ้ายจองบัตร / แตะขวาขอ LINE ID)',
    badge: 'พรีเมียมแบนเนอร์',
    size: { width: 2500, height: 843 },
    chatBarText: '🎫 แตะเพื่อจองบัตรคอนเสิร์ต',
    previewImage: '/rich-menu/rich-menu-small-1banner-2500x843.jpg',
    fileJpg: 'rich-menu-small-1banner-2500x843.jpg',
    filePng: 'rich-menu-small-1banner-2500x843.png',
    buildAreas(baseUrl) {
      const base = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
      return [
        {
          bounds: { x: 0, y: 0, width: 1250, height: 843 },
          action: { type: 'uri', label: 'แตะเพื่อจองบัตรบนเว็บ', uri: `${base}/` }
        },
        {
          bounds: { x: 1250, y: 0, width: 1250, height: 843 },
          action: { type: 'message', label: 'รับรหัส LINE ID', text: 'บัตร' }
        }
      ];
    }
  }
};

function listRichMenuTemplates(baseUrl = DEFAULT_BASE_URL) {
  return Object.values(RICH_MENU_TEMPLATES).map((tpl) => ({
    key: tpl.key,
    title: tpl.title,
    badge: tpl.badge,
    size: tpl.size,
    chatBarText: tpl.chatBarText,
    previewImage: tpl.previewImage,
    areasCount: tpl.buildAreas(baseUrl).length,
    areas: tpl.buildAreas(baseUrl)
  }));
}

function buildRichMenuPayload(templateKey = 'large_6grid', baseUrl = DEFAULT_BASE_URL) {
  const tpl = RICH_MENU_TEMPLATES[templateKey] || RICH_MENU_TEMPLATES.large_6grid;
  return {
    size: tpl.size,
    selected: true,
    name: `STAGE PASS - ${tpl.key}`,
    chatBarText: tpl.chatBarText,
    areas: tpl.buildAreas(baseUrl)
  };
}

async function deployRichMenuToLine({ templateKey = 'large_6grid', channelAccessToken = '', baseUrl = DEFAULT_BASE_URL } = {}) {
  const tpl = RICH_MENU_TEMPLATES[templateKey] || RICH_MENU_TEMPLATES.large_6grid;
  const payload = buildRichMenuPayload(tpl.key, baseUrl);
  const token = String(channelAccessToken || '').trim();

  const richMenuDir = path.join(__dirname, '..', 'rich-menu');
  const jpgPath = path.join(richMenuDir, tpl.fileJpg);
  const pngPath = path.join(richMenuDir, tpl.filePng);
  let imagePath = fs.existsSync(jpgPath) ? jpgPath : pngPath;
  let contentType = imagePath.endsWith('.jpg') ? 'image/jpeg' : 'image/png';

  if (!fs.existsSync(imagePath)) {
    return {
      ok: false,
      error: `ไม่พบไฟล์ภาพ Rich Menu (${tpl.fileJpg})`
    };
  }

  const imageBuffer = fs.readFileSync(imagePath);

  if (!token) {
    return {
      ok: true,
      simulated: true,
      templateKey: tpl.key,
      richMenuId: `richmenu-sim-${tpl.key}-${Date.now()}`,
      imageSizeKB: Math.round(imageBuffer.length / 1024),
      payload,
      message: `จำลองการติดตั้ง Rich Menu "${tpl.title}" สำเร็จ (${Math.round(imageBuffer.length / 1024)} KB) · กรุณาใส่ LINE Channel Access Token เพื่ออัปโหลดขึ้นบัญชี LINE OA จริง`
    };
  }

  try {
    // Step 1: Create Rich Menu object on LINE Messaging API
    const createRes = await fetch('https://api.line.me/v2/bot/richmenu', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      return {
        ok: false,
        error: `สร้างโครงสร้าง Rich Menu บน LINE API ไม่สำเร็จ (${createRes.status}): ${errText.slice(0, 200)}`
      };
    }

    const { richMenuId } = await createRes.json();

    // Step 2: Upload Rich Menu Image (< 1MB) to api-data.line.me
    const uploadRes = await fetch(`https://api-data.line.me/v2/bot/richmenu/${encodeURIComponent(richMenuId)}/content`, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        Authorization: `Bearer ${token}`
      },
      body: imageBuffer
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return {
        ok: false,
        richMenuId,
        error: `อัปโหลดรูปภาพ Rich Menu ไม่สำเร็จ (${uploadRes.status}): ${errText.slice(0, 200)}`
      };
    }

    // Step 3: Set as Default Rich Menu for all LINE OA users
    const defaultRes = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${encodeURIComponent(richMenuId)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!defaultRes.ok) {
      const errText = await defaultRes.text();
      return {
        ok: false,
        richMenuId,
        error: `ตั้งค่า Default Rich Menu ไม่สำเร็จ (${defaultRes.status}): ${errText.slice(0, 200)}`
      };
    }

    return {
      ok: true,
      simulated: false,
      templateKey: tpl.key,
      richMenuId,
      imageSizeKB: Math.round(imageBuffer.length / 1024),
      payload,
      message: `ติดตั้งและเปิดใช้งาน LINE Rich Menu (${tpl.title}) บน LINE OA สำเร็จ! (ID: ${richMenuId})`
    };
  } catch (err) {
    return {
      ok: false,
      error: `ไม่สามารถเชื่อมต่อ LINE Messaging API: ${err.message}`
    };
  }
}

function buildWebhookReplyMessages(userId, options = {}) {
  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const displayName = String(options.displayName || '').trim();
  const incomingText = String(options.text || '').trim();

  const autoFillUrl = `${baseUrl}/?lineUserId=${encodeURIComponent(userId)}${displayName ? `&lineName=${encodeURIComponent(displayName)}` : ''}`;
  const myTicketsUrl = `${baseUrl}/?lineUserId=${encodeURIComponent(userId)}&action=my-tickets`;

  const idTextMessage = {
    type: 'text',
    text: `สวัสดีครับ! รหัส LINE User ID ของคุณสำหรับรับบัตรคอนเสิร์ตคือ:\n${userId}\n\nคัดลอกรหัสนี้ไปวางในช่อง LINE User ID บนหน้าจองบัตร หรือกดปุ่ม "จองบัตรพร้อมเชื่อม LINE อัตโนมัติ" ด้านล่างได้เลยครับ`
  };

  const quickBookingFlex = {
    type: 'flex',
    altText: 'เชื่อมต่อ LINE สำเร็จ! กดปุ่มเพื่อจองบัตรโดยกรอกรหัส LINE อัตโนมัติ',
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#06C755',
        paddingAll: '14px',
        contents: [
          {
            type: 'text',
            text: '🟢 เชื่อมต่อบัญชีรับบัตร E-Ticket สำเร็จ',
            color: '#FFFFFF',
            weight: 'bold',
            size: 'sm'
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1E1E1E',
        paddingAll: '16px',
        spacing: 'sm',
        contents: [
          {
            type: 'text',
            text: displayName ? `บัญชีของคุณ: ${displayName}` : 'รหัสรับบัตรของคุณพร้อมใช้งานแล้ว',
            color: '#FFFFFF',
            weight: 'bold',
            size: 'sm',
            wrap: true
          },
          {
            type: 'text',
            text: `LINE ID: ${userId}`,
            color: '#68D391',
            size: 'xs',
            wrap: true
          },
          {
            type: 'text',
            text: incomingText === 'วิธีชำระเงิน'
              ? '💡 ขั้นตอนชำระเงิน: เลือกโต๊ะ/โซน -> สแกนจ่ายผ่าน QR PromptPay -> แนบรูปสลิปในหน้าเว็บ ระบบตรวจสลิปและส่งบัตรเข้าแชทนี้ทันที'
              : incomingText === 'ติดต่อแอดมิน'
              ? '💬 ต้องการสอบถามรอบการแสดง เหมาโต๊ะ VIP หรือแจ้งปัญหา พิมพ์ข้อความทิ้งไว้ในแชทนี้ได้เลยครับ แอดมินดูแลตลอด 24 ชม.'
              : 'แตะปุ่มด้านล่างเพื่อเข้าหน้าเว็บโดยกรอกรหัส LINE User ID ให้อัตโนมัติ 100% ไม่ต้องคัดลอกวางเอง',
            color: '#CCCCCC',
            size: 'xs',
            wrap: true,
            margin: 'sm'
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#1E1E1E',
        paddingAll: '14px',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#06C755',
            height: 'sm',
            action: {
              type: 'uri',
              label: '🎫 จองบัตร (กรอก LINE ID อัตโนมัติ)',
              uri: autoFillUrl
            }
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: {
              type: 'uri',
              label: '🎟️ เปิดดูบัตร E-Ticket ของฉัน',
              uri: myTicketsUrl
            }
          }
        ]
      }
    }
  };

  return [idTextMessage, quickBookingFlex];
}

async function replyLineWebhook(replyToken, userId, channelAccessToken, options = {}) {
  const messages = buildWebhookReplyMessages(userId, options);
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
  replyLineWebhook,
  listRichMenuTemplates,
  buildRichMenuPayload,
  deployRichMenuToLine
};

