import Image from 'next/image'
import Link from 'next/link'
import { ArrowUpRight, ArrowRight, Check, Heart, ScanFace, UploadCloud, Bell, Camera, ChartNoAxesCombined, Images, Link2 } from 'lucide-react'
import LanguageSwitch from '@/components/language-switch'
import { getServerDictionary } from '@/lib/i18n-server'
import s from './landing.module.css'

const photos = ['editorial-couple', 'editorial-bride', 'editorial-details', 'editorial-reception', 'editorial-walk', 'feature-share']
const icons = [Images, UploadCloud, ScanFace, Heart, Images, ChartNoAxesCombined, Bell, Camera]
const plans = [
  { name: 'Free', space: '5 GB', price: '0' },
  { name: 'Starter', space: '20 GB', price: '299' },
  { name: 'Pro', space: '50 GB', price: '499' },
  { name: 'Business', space: '100 GB', price: '699' },
]

export default async function HomePage() {
  const { locale, t } = await getServerDictionary()
  const L = t.landing
  const text = (th: string, en: string) => locale === 'th' ? th : en
  const faq = [
    [text('ลูกค้าต้องสมัครสมาชิกก่อนดูรูปไหม?', 'Do clients need an account?'), text('ไม่ต้องครับ ผู้รับลิงก์เปิดดูแกลเลอรีได้โดยไม่ต้องสมัครบัญชี และดาวน์โหลดได้ตามสิทธิ์ที่เจ้าของงานกำหนด', 'No. Recipients can open a gallery without an account and download according to the permissions you set.')],
    [text('เริ่มใช้งานอย่างไร?', 'How do I get started?'), text('สมัครบัญชี สร้างงาน แล้วอัปโหลดรูปภาพ เมื่อไฟล์พร้อมให้ตั้งค่าการแชร์และส่งลิงก์ให้ลูกค้าได้เลย', 'Create an account, create a job, and upload your photographs. Once the files are ready, choose your sharing settings and send the link.')],
    [text('รูปจากแขกจะปนกับรูปช่างภาพไหม?', 'Are guest photos mixed with my gallery?'), text('โมเมนต์จากแขกแสดงแยกจากแกลเลอรีช่างภาพ ผู้ชมจึงเลือกดูทั้งสองส่วนได้สะดวก', 'Guest Moments stay separate from the photographer’s gallery, so visitors can explore both clearly.')],
    [text('ใช้เป็นพอร์ตโฟลิโอรับงานได้ไหม?', 'Can I use Ciiya as my portfolio?'), text('ได้ครับ เลือกรูปแบบ จัดภาพผลงาน และเพิ่ม Facebook, Instagram หรือเบอร์โทร แล้วเผยแพร่ลิงก์พอร์ตโฟลิโอของคุณ', 'Yes. Choose a design, arrange your work, and add Facebook, Instagram, or a phone number before publishing your portfolio link.')],
  ]
  return (
    <main className={s.page} data-accent="gold">
      <header className={s.header}>
        <div className={s.nav}>
          <Link href="/" aria-label="Ciiya"><Image src="/logo-usage.svg" width={112} height={42} alt="Ciiya" className={s.logo} /></Link>
          <nav className={s.navLinks} aria-label={text('เมนูหลัก', 'Main navigation')}>
            <a href="#features">{L.nav.features}</a><a href="#workflow">{L.nav.howItWorks}</a><a href="#portfolio">{L.nav.portfolio}</a><a href="#pricing">{L.nav.pricing}</a>
          </nav>
          <div className={s.navActions}><LanguageSwitch current={locale} /><Link className={s.login} href="/login">{L.nav.signIn}</Link><Link className={s.smallButton} href="/signup">{L.nav.startFree}<ArrowUpRight size={16} /></Link></div>
        </div>
        <nav className={s.mobileNav} aria-label={text('สำรวจ Ciiya', 'Explore Ciiya')}><a href="#features">{L.nav.features}</a><a href="#portfolio">{L.nav.portfolio}</a><a href="#pricing">{L.nav.pricing}</a><Link href="/login">{L.nav.signIn}</Link></nav>
      </header>

      <section className={s.hero}>
        <div className={s.heroCopy}>
          <p className={s.eyebrow}><span />{text('สำหรับทุกงานที่คุณตั้งใจถ่าย', 'FOR THE WORK YOU CARE ABOUT')}</p>
          <h1>{text('ภาพสวยแล้ว', 'Beautiful photographs.')}<br />{text('ส่งมอบให้', 'Beautifully ')}<em>{text('น่าจดจำ', 'delivered.')}</em></h1>
          <p className={s.lead}>{text('ให้ลูกค้าเปิดดูรูปด้วยรอยยิ้ม จัดเก็บ ส่งแกลเลอรี และโชว์ผลงานของคุณในพื้นที่เดียวที่ชื่อ Ciiya', 'Give clients a gallery they will love opening. Store photographs, deliver galleries, and showcase your work in one place: Ciiya.')}</p>
          <div className={s.actions}><Link className={s.button} href="/signup">{text('สร้างแกลเลอรี่แรก', 'Create your first gallery')}<ArrowUpRight size={19} /></Link><a className={s.textLink} href="#experience">{text('ดูประสบการณ์ส่งรูป', 'Explore the experience')}<ArrowRight size={17} /></a></div>
          <p className={s.reassurance}><Check size={15} />{text('เริ่มใช้ฟรี • ลูกค้าเปิดดูได้โดยไม่ต้องสมัคร', 'Start free • No account needed for recipients')}</p>
        </div>
        <div className={s.heroVisual}>
          <div className={s.visualCaption}><span>CIIYA / CLIENT GALLERY</span><span>{text('ตัวอย่างการนำเสนอ', 'ILLUSTRATIVE PREVIEW')}</span></div>
          <div className={s.galleryWindow}>
            <div className={s.windowBar}><span className={s.dots}>● ● ●</span><span>ciiya / gallery</span><Link2 size={14} /></div>
            <div className={s.galleryCover}><Photo name="editorial-walk" alt={text('คู่บ่าวสาวเดินด้วยกันในสวน', 'Newlyweds walking in a garden')} priority /><div><span>THE WEDDING COLLECTION</span><h2>A day to remember.</h2><p>24.05.2026 · The Riverside</p></div></div>
            <div className={s.galleryToolbar}><span>{text('ทุกช่วงเวลาสำคัญ', 'Every little moment')}</span><span><Heart size={14} />{text('ภาพที่ชอบ', 'Favorites')}</span></div>
            <div className={s.galleryGrid}>{photos.slice(0,4).map((name) => <div key={name}><Photo name={name} alt="" /></div>)}</div>
          </div>
          <div className={s.floatingNote}><span className={s.noteIcon}><Check size={20} /></span><div><strong>{text('พร้อมส่งความทรงจำ', 'Ready to share')}</strong><p>{text('หนึ่งลิงก์ สำหรับภาพทั้งงาน', 'One link. The whole story.')}</p></div></div>
        </div>
      </section>

      <div className={s.promiseStrip}>{[text('จัดเก็บต้นฉบับ', 'Original file storage'),text('แชร์ผ่านลิงก์เดียว', 'One-link delivery'),text('ค้นหารูปด้วยใบหน้า', 'Face search'),text('สร้างพอร์ตโฟลิโอ', 'Your own portfolio')].map((item)=><span key={item}><Check size={16}/>{item}</span>)}</div>

      <section id="experience" className={s.section}>
        <div className={s.sectionHeading}><div><p className={s.eyebrow}>{text('มากกว่าการส่งไฟล์', 'MORE THAN FILE DELIVERY')}</p><h2>{text('ทุกครั้งที่เปิดลิงก์', 'Every time they open it,')}<br/>{text('คือการกลับไปยังช่วงเวลาดี ๆ', 'the moment comes back.')}</h2></div><p>{text('ภาพของคุณควรได้พื้นที่ที่เหมาะสม แกลเลอรีที่ดูง่าย ชวนให้เลือกภาพโปรด และเก็บความทรงจำกลับไป', 'Your photographs deserve a considered home. A gallery made for browsing, finding favorites, and taking memories home.')}</p></div>
        <div className={s.experienceGrid}>
          <article className={s.largeStory}><div className={s.storyImage}><Photo name="feature-share" alt={text('คู่บ่าวสาวเปิดดูภาพจากงานแต่ง', 'A couple enjoying their wedding photographs')}/></div><div className={s.storyCopy}><span>01 / {text('ส่งมอบ', 'DELIVER')}</span><h3>{text('ลูกค้าเปิดลิงก์ คุณส่งความประทับใจ', 'A link for them. A lasting impression from you.')}</h3><p>{text('ดูรูป กดหัวใจ และดาวน์โหลดตามสิทธิ์ที่คุณตั้งไว้ ทั้งหมดอยู่ในแกลเลอรีเดียว', 'Browse, heart, and download with the permissions you choose. All in one gallery.')}</p></div></article>
          <div className={s.sideStories}>
            <article className={s.searchStory}><ScanFace size={28} strokeWidth={1.4}/><span>02 / {text('ค้นพบ', 'DISCOVER')}</span><h3>{text('รูปของฉัน อยู่ตรงนี้เอง', 'There I am.')}</h3><p>{text('ใช้เซลฟีช่วยค้นหารูปของตัวเองในงาน ให้แขกใช้เวลากับภาพที่มีความหมาย', 'A selfie helps guests find themselves in the gallery and spend time with the photographs that matter.')}</p><div className={s.faceStrip}>{['editorial-bride','editorial-couple','editorial-walk'].map(name=><div key={name}><Photo name={name} alt=""/></div>)}</div></article>
            <article className={s.momentStory}><div><span>03 / {text('มีส่วนร่วม', 'CONTRIBUTE')}</span><h3>{text('ความทรงจำจากทุกมุม', 'Every point of view.')}</h3><p>{text('แขกแชร์ภาพและข้อความผ่านโมเมนต์ แยกเป็นพื้นที่พิเศษจากภาพช่างภาพ', 'Guests add photographs and messages in their own space, separate from your gallery.')}</p></div><Heart size={32} strokeWidth={1.3}/></article>
          </div>
        </div>
      </section>

      <section id="features" className={s.toolbox}>
        <div className={s.sectionHeading}><div><p className={s.eyebrow}>{text('พื้นที่ทำงานของคุณ', 'YOUR WORKSPACE')}</p><h2>{text('เบื้องหลังที่เรียบง่าย', 'Simple behind the scenes.')}<br/>{text('ให้งานข้างหน้าไปได้ไกล', 'Ready for what is next.')}</h2></div><p>{text('ตั้งแต่ภาพแรกที่อัปโหลด ถึงกิจกรรมหลังส่งงาน เลือกใช้เครื่องมือที่เหมาะกับวิธีทำงานของคุณ', 'From the first upload to activity after delivery, find the tools that fit your way of working.')}</p></div>
        <div className={s.toolGrid}>{L.capabilities.items.map((item,i)=>{const Icon=icons[i];return <article key={item.title}><Icon size={25} strokeWidth={1.4}/><h3>{item.title}</h3><p>{item.detail}</p></article>})}</div>
      </section>

      <section id="workflow" className={s.workflow}>
        <div><p className={s.eyebrow}>{text('เริ่มต้นได้ง่าย', 'A SIMPLE START')}</p><h2>{text('จากกล้อง', 'From camera')}<br/>{text('ถึงลูกค้า', 'to client.')}<span> / 03</span></h2><Link className={s.textLink} href="/signup">{text('เริ่มงานแรกของคุณ', 'Start your first job')}<ArrowUpRight size={18}/></Link></div>
        <ol>{L.workflow.steps.map((item,i)=><li key={item.title}><span>0{i+1}</span><div><h3>{item.title}</h3><p>{item.detail}</p></div>{i<2&&<ArrowRight className={s.stepArrow} size={20}/>}</li>)}</ol>
      </section>

      <section id="portfolio" className={s.portfolio}>
        <div className={s.portfolioCopy}><p className={s.eyebrow}>{text('ให้ผลงานแนะนำตัวคุณ', 'LET YOUR WORK INTRODUCE YOU')}</p><h2>{text('พื้นที่เล็ก ๆ', 'Your own space.')}<br/>{text('สำหรับตัวตนที่ชัดเจน', 'Unmistakably you.')}</h2><p>{text('เลือกภาพที่บอกความเป็นคุณ จัดรูปแบบให้เข้ากับสไตล์ แล้วแชร์พอร์ตโฟลิโอพร้อมช่องทางติดต่องาน', 'Choose the photographs that express your style. Give them a design of their own and share a portfolio with your contact details.')}</p><div className={s.portfolioTags}><span>{text('เลือกรูปแบบได้', 'Choose a design')}</span><span>{text('จัดลำดับภาพเอง', 'Arrange your work')}</span><span>{text('เพิ่มช่องทางติดต่อ', 'Add contact links')}</span></div><Link className={s.button} href="/signup">{text('สร้างพอร์ตโฟลิโอของคุณ', 'Build your portfolio')}<ArrowUpRight size={18}/></Link></div>
        <div className={s.portfolioPreview}><div className={s.portfolioHeader}><span>THE RIVERSIDE STUDIO</span><span>PORTFOLIO / 01</span></div><div className={s.portfolioImages}><div><Photo name="editorial-bride" alt={text('ภาพเจ้าสาวในแสงธรรมชาติ', 'Bridal portrait in natural light')}/></div><div><Photo name="editorial-details" alt={text('รายละเอียดแหวนแต่งงาน', 'Wedding ring details')}/></div></div><div className={s.portfolioSignature}><span>Quiet moments.<br/><em>Honest stories.</em></span><span>{text('ตัวอย่างพอร์ตโฟลิโอ', 'PORTFOLIO PREVIEW')}</span></div></div>
      </section>

      <section id="pricing" className={s.section}>
        <div className={s.centerHeading}><p className={s.eyebrow}>{text('เริ่มจากงานแรก เติบโตไปด้วยกัน', 'START WITH ONE GALLERY')}</p><h2>{text('พื้นที่พอดี กับทุกระยะของคุณ', 'Room for every stage.')}</h2><p>{text('เริ่มใช้ฟรี แล้วเลือกพื้นที่เพิ่มตามจำนวนงานที่คุณดูแล', 'Start free, then choose more space as your work grows.')}</p></div>
        <div className={s.pricingGrid}>{plans.map((plan,i)=><article key={plan.name} className={i===2?s.featuredPlan:''}><div className={s.planName}><h3>{plan.name}</h3>{i===2&&<span>{text('สำหรับมืออาชีพ', 'PROFESSIONAL')}</span>}</div><p className={s.planPrice}>฿{plan.price}<small>{i===0?text(' / ฟรี', ' / free'):text(' / เดือน',' / month')}</small></p><p className={s.planSpace}>{plan.space}</p><p>{L.pricing.plans[i].detail}</p><ul>{L.pricing.plans[i].features.map(f=><li key={f}><Check size={15}/>{f}</li>)}</ul></article>)}</div>
        <p className={s.pricingNote}>{text('ราคาเป็นเงินบาท • รายละเอียดแพ็กเกจสำหรับประกอบการเลือกใช้งาน', 'Prices in Thai baht • Plan information to help you choose')}</p>
      </section>

      <section className={s.faq}><div><p className={s.eyebrow}>{text('ก่อนเริ่มใช้งาน', 'BEFORE YOU BEGIN')}</p><h2>{text('อยากรู้เพิ่มเติม?', 'A few good questions.')}</h2><p>{text('คำตอบสั้น ๆ สำหรับแกลเลอรีแรกของคุณ', 'A little clarity before your first gallery.')}</p></div><div>{faq.map(([q,a])=><details key={q}><summary>{q}<span>+</span></summary><p>{a}</p></details>)}</div></section>

      <section className={s.finalCta}><div><Photo name="editorial-couple" alt={text('ภาพคู่บ่าวสาวในสวน', 'A wedding portrait in a garden')}/></div><div><p className={s.eyebrow}>{text('งานถัดไป ส่งด้วย Ciiya', 'YOUR NEXT DELIVERY, WITH CIIYA')}</p><h2>{text('ให้ภาพที่คุณรัก', 'The work you love.')}<br/>{text('ไปถึงคนที่รอ', 'For the people waiting.')}</h2><p>{text('สร้างแกลเลอรี่แรกของคุณวันนี้ แล้วลองเปิดดูในมุมของลูกค้า', 'Create your first gallery today. See it through your client’s eyes.')}</p><Link className={s.lightButton} href="/signup">{text('เริ่มใช้งานฟรี', 'Start for free')}<ArrowUpRight size={19}/></Link></div></section>
      <footer className={s.footer}><div><Image src="/logo-usage.svg" width={100} height={38} alt="Ciiya"/><p>{text('เก็บภาพสำคัญ ให้สวยและเข้าถึงง่าย', 'A considered home for meaningful photographs.')}</p></div><div><LanguageSwitch current={locale}/><Link href="/login">{L.nav.signIn}</Link><Link href="/signup">{L.nav.createAccount}</Link><span>© {new Date().getFullYear()} Ciiya</span></div></footer>
    </main>
  )
}

function Photo({ name, alt, priority = false }: { name: string; alt: string; priority?: boolean }) {
  // `priority` emits <link rel=preload fetchpriority=high> for the LCP hero image
  // and lazy-loads the rest, so the first paint arrives sooner.
  return <Image src={'/landing/' + name + '.webp'} alt={alt} fill priority={priority} loading={priority ? 'eager' : 'lazy'} sizes="(max-width: 700px) 92vw, (max-width: 1100px) 50vw, 640px" className={s.photo}/>
}
