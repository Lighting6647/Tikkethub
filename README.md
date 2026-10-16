# ระบบจองบัตรคอนเสิร์ต (Thai Ticket Concert System)

ระบบจองบัตรคอนเสิร์ตที่ออกแบบตาม **Design System ของ thaiticketmajor.com** 

---

## 🎨 Design System Implementation

| Role | Color | Usage |
|---|---|---|
| **Primary** | `#B40000` | ปุ่ม CTA หลัก (ซื้อบัตร, จองบัตรเลย, ยืนยัน) |
| **Accent** | `#229BFF` | สถานะบัตร, จุดเน้น (Selling Fast, Highlights) |
| **Surface** | `#333333` | พื้นหลังของหน้าเว็บหลัก |
| **Elevated** | `#434343` | การ์ดคอนเสิร์ต, Modal, กล่องแสดงผล |
| **Text** | `#FFFFFF` | ตัวอักษรเนื้อหาและหัวข้อหลัก |
| **Muted** | `#999999` | ข้อความรอง, วันที่, สถานที่ |
| **Border** | `#CCCCCC` | ขอบและเส้นแบ่ง |

### Typography & Spacing
- **Font**: `Noto Sans Thai` (Google Fonts)
- **Scale**: H1 (28px/700), H2 (22px/300), H3 (14px/400), Body (13px/400)
- **Spacing Scale**: 4px, 8px, 12px, 16px, 20px, 32px
- **Border Radius**: 4px (ปุ่มมาตรฐาน), 50px (ปุ่ม Pill), 5px (ช่อง Search Input), 12px (การ์ด)

---

## 🚀 ฟีเจอร์ที่พัฒนาแล้ว

1. **Header & Navigation Bar**:
   - ช่องค้นหา (Search Bar) แบบ Real-time ตามสเปก Input token (padding 10px 50px 10px 20px)
   - แถบหมวดหมู่ (All, K-POP, คอนเสิร์ตไทย, World Tour, มิวสิคเฟสติวัล, แฟนมีตติ้ง)
   - ป้ายแจ้งเตือนตะกร้าบัตรคอนเสิร์ต (My Tickets Counter)

2. **Hero Highlight Banner**:
   - การไล่สี Gradient `#333333` ถึง `#000000`
   - แบนเนอร์คอนเสิร์ตเด่นระดับ World Tour พร้อมปุ่ม CTA `#B40000` และ Secondary `#EEEEEE`

3. **Concert Listing & Cards**:
   - การ์ดคอนเสิร์ตในแบบ Elevated (`#434343`), subtle border, 12px radius
   - แสดงราคาเริ่มต้น, วันที่, สถานที่จัดแสดง, ป้ายสถานะบัตร (Badge)

4. **Interactive Booking Modal (ระบบเลือกรอบและโซนบัตร)**:
   - เลือกระหว่าง VIP Standing, Zone A, Zone B, Zone C
   - ปรับจำนวนบัตร (+ / -) และคำนวณยอดเงินรวมแบบ Real-time
   - บันทึกการจองและอัปเดตจำนวนบัตรใน Header พร้อม Toast notification

---

## 💻 วิธีเปิดใช้งาน
- ดับเบิ้ลคลิกเปิดไฟล์ `index.html` ใน Google Chrome, Microsoft Edge หรือเบราว์เซอร์ใดก็ได้
