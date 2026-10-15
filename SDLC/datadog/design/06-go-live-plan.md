# 06 — Go-live Plan (ถึง 2026-10-20)

## 1. สถานะ ณ 2026-10-15

**พร้อมแล้ว (ทดสอบจริง):** stack dev ครบ · prod overlay (`docker-compose.prod.yml`) ขึ้นได้ทุก service บน prod-test ·
Keycloak prod บน Postgres · kc-sync · backup → Garage · device onboarding E2E กับ edge-bridge จริง ·
dashboards แก้ไขได้ · หน้าใหม่ (SLOs, Infrastructure, wizard, sign-in) · prod ปฏิเสธ dev token

## 2. Bugs / blockers ที่ต้องปิดก่อนเปิด

| # | ปัญหา | ผลกระทบ | สาเหตุที่รู้ | งาน |
|---|---|---|---|---|
| G1 | หน้า sign-in บน prod-test แสดงปุ่ม Demo/ช่อง token ทั้งที่ `dev_tokens:false` | สับสน, ดูไม่มืออาชีพ (backend ปฏิเสธอยู่แล้ว ไม่ใช่ช่องโหว่) | ยังไม่รู้ — ต้องตรวจ `SignInWall` ว่าอ่าน config ก่อน render หรือไม่ | debug + fix + ทดสอบบน prod-test |
| G2 | กด "company account" บน prod-test ถูกพาไป `localhost:5173` แทน `:5180` | sign-in ใช้ไม่ได้ถ้าเกิดบน prod | discovery ของ Keycloak ตอบ `:5180` ถูก → สงสัย cache ของ Chrome profile / client `rootUrl` / redirect จาก realm เดิม | debug ด้วย network log |
| G3 | `tag_history` ไม่มี prune job | ดิสก์ VPS เต็มในไม่กี่วัน (~43 ล้านแถว/วันที่ 10 อุปกรณ์) | ออกแบบไว้แต่ไม่ได้ทำ | เพิ่ม job ลบ > 8 ชม. ทุก 5 นาที + index ตรวจ |
| G4 | ยังไม่มีกลไก feature flag | หน้า Downtimes/Errors (ข้อมูลจำลอง) จะโผล่ใน prod | — | `VITE_FEATURES` ซ่อนเมนู + route |
| G5 | ไอคอน druids (ลิขสิทธิ์ Datadog) ยังใช้ทั้ง rail | ความเสี่ยงลิขสิทธิ์เมื่อขาย/เผยแพร่ | — | map `DdIcon` → lucide (คง API เดิม) |
| G6 | UAT นับเมนู 13 แต่ตอนนี้มากกว่า | CI UAT fail | เมนูใหม่ | อัปเดต `tests/e2e/uat.mjs` |
| G7 | bootstrap CLI ยังไม่ทดสอบ E2E (ล็อกอิน → none → bootstrap → owner) | onboarding ลูกค้าแรกอาจติด | — | ทดสอบบน prod-test |
| G8 | Google sign-in ยังไม่ทดสอบกับบัญชีจริง | ปุ่ม Google ใช้ไม่ได้ | ไม่มี OAuth client | สร้าง client ใน Google Console (ผู้ใช้) → ทดสอบ |
| G9 | `GOOGLE_CLIENT_SECRET` เป็น env (เห็นใน `docker inspect`) | secret hygiene | — | ย้ายเป็น `*_FILE` |

## 3. แผนรายวัน

| วัน | งาน | ผลลัพธ์ที่ตรวจได้ |
|---|---|---|
| **15 ต.ค.** | อนุมัติ design pack นี้ · G1 · G2 | sign-in prod-test ผ่าน SSO จริง |
| **16 ต.ค.** | G3 prune · G4 flags · G7 bootstrap E2E · restore drill | ดิสก์คงที่ · เมนู prod ไม่มีหน้า demo · owner เข้าใช้งานได้ · restore + verify-audit ผ่าน |
| **17 ต.ค.** | G5 ไอคอน · G6 UAT · G9 · ผู้ใช้: ซื้อ/ตั้ง VPS + DNS (`ops.` และ `mqtt.`) + R2/Garage | UAT เขียว · VPS พร้อม |
| **18 ต.ค.** | ติดตั้ง Dokploy · File Mounts (secrets PROD=1, certs ด้วย `MQTT_PUBLIC_HOST`) · deploy · domain + HTTPS · uptime probe | `https://<domain>/api/health` = ok จากภายนอก |
| **19 ต.ค.** | bootstrap องค์กรแรก · เพิ่ม local PC (YOLO) เป็นอุปกรณ์ · Factory I/O → edge · smoke ทุกบทบาท · แก้ปัญหา | ค่าจริงขึ้นจอ, operator ack ได้, ผู้จัดการเห็น dashboard |
| **20 ต.ค.** | freeze · สำรอง backup · demo | go-live |

## 4. Go-live checklist

**ก่อน deploy**
- [ ] CI เขียว (static, contract, integration, UAT)
- [ ] G1–G7 ปิดแล้ว (G8, G9 อนุโลมได้ถ้า Google ปิด)
- [ ] secrets สร้างด้วย `PROD=1 SECRETS_DIR=../files/secrets ./infra/gen-secrets.sh` + เก็บสำเนาใน password manager
- [ ] certs สร้างด้วย `MQTT_PUBLIC_HOST=mqtt.<domain> CERTS_DIR=../files/certs ./infra/gen-certs.sh`
- [ ] `backup_s3_key_id` / `backup_s3_secret` วางใน `../files/secrets` (key เขียนได้เฉพาะ bucket)
- [ ] env ใน Dokploy: `PUBLIC_URL`, `SECRETS_DIR`, `CERTS_DIR`, `BACKUP_S3_ENDPOINT`, (`GOOGLE_*`)
- [ ] firewall: 80/443/8883 เปิด, 22 จำกัด, 5432/8080/8001 **ปิด**

**หลัง deploy**
- [ ] `/api/auth/config` → `env:prod`, `dev_tokens:false`
- [ ] demo token → 401 · `/realms/master` ผ่านโดเมนเข้าไม่ได้
- [ ] sign-in SSO สำเร็จ, ผู้ใช้ใหม่เห็น "ไม่มีสิทธิ์" ก่อน bootstrap
- [ ] backup log มี "backup ok" ทั้ง `wds` และ `keycloak`
- [ ] edge จากภายนอกต่อ `mqtt.<domain>:8883` ได้ (cert SAN ถูก)
- [ ] uptime probe ส่งอีเมลทดสอบได้
- [ ] MFA (OTP) เปิดสำหรับ role admin/owner ใน Keycloak
- [ ] privacy notice (PDPA) บนหน้า landing/sign-in

## 5. ข้อตัดสินใจของผู้ออกแบบ (รออนุมัติ — จาก builder check)

| เรื่อง | ตัดสินใจ |
|---|---|
| Branch deploy | สร้าง `main` จาก `ui-v4` ก่อนวันที่ 18 → Dokploy deploy จาก `main` |
| CI gate | ต้องเขียวก่อน deploy — G6 (นับเมนู UAT) แก้ก่อน ไม่ข้าม |
| Dashboards ข้ามเครื่อง | go-live: seed dashboard เริ่มต้นต่อ role (ฝั่ง frontend) · ย้ายไป backend หลัง go-live |
| G2 | กันเวลาครึ่งวันสำหรับตั้ง client Keycloak ใหม่ (redirect/rootUrl) |
| Downtimes / Errors | ซ่อนเฉพาะ UI — ไม่มี endpoint backend จริงอยู่แล้ว (ใช้ mock) |

## 6. คำสั่งอ้างอิง

```bash
# ซ้อม prod บนเครื่อง dev (โปรเจกต์แยก ไม่ชน stack dev)
export SECRETS_DIR=... CERTS_DIR=... PUBLIC_URL=http://localhost:5180 \
       COMPOSE_SUBNET=172.31.20.0/24 WEB_IP=172.31.20.10 TRUSTED_PROXIES=172.31.20.10/32 \
       BACKUP_S3_ENDPOINT=http://host.docker.internal:3900
docker compose -p wds-prodtest -f docker-compose.yml -f docker-compose.prod.yml -f <test-ports.yml> up -d --build --wait

# เปิดใช้งานลูกค้า (หลังเจ้าของล็อกอินครั้งแรก)
docker compose exec backend python -m app.bootstrap --org "Acme Aggregates" --site "Plant 1" \
  --site-code P1 --timezone Asia/Bangkok --owner-email owner@acme.com

# Garage (เครื่องแยก): ครั้งแรก
cp deploy/garage/garage.toml.example deploy/garage/garage.toml  # แทน secret 2 ค่า
docker compose -f deploy/garage/docker-compose.yml up -d && ./deploy/garage/init.sh 100G
```
