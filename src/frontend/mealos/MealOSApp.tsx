'use client';

import { useMemo, useRef, useState } from 'react';
import {
  COOKING_STEPS,
  DINEOUT_PLACES,
  INGREDIENTS,
  LATENIGHT,
  RECIPES,
  RESTAURANTS,
  type DineoutPlace,
  type Recipe,
} from './data';

type Mode = 'landing' | 'intent' | 'instamart' | 'delivery' | 'dineout' | 'latenight';

const CHIPS: { id: string; icon: string; label: string; mode: Mode }[] = [
  { id: 'instamart', icon: 'CK', label: 'Cook something healthy', mode: 'instamart' },
  { id: 'delivery', icon: 'OD', label: 'Order quickly', mode: 'delivery' },
  { id: 'dineout', icon: 'DN', label: 'Plan a dinner', mode: 'dineout' },
  { id: 'latenight', icon: 'LN', label: 'Late night cravings', mode: 'latenight' },
];

const THEME_BY_MODE: Record<Mode, string> = {
  landing: 'neutral',
  intent: 'neutral',
  instamart: 'instamart',
  delivery: 'delivery',
  dineout: 'dineout',
  latenight: 'latenight',
};

function modeFromQuery(query: string): Mode {
  const q = query.toLowerCase();
  if (/cook|recipe|home|healthy/.test(q)) return 'instamart';
  if (/order|deliver|quick|fast/.test(q)) return 'delivery';
  if (/dinner|date|dine|restaurant|plan/.test(q)) return 'dineout';
  if (/night|late|midnight|craving/.test(q)) return 'latenight';
  return 'intent';
}

function PlaceholderVisual({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="card-img-placeholder" style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 11, opacity: 0.7 }}>{subtitle}</div>
    </div>
  );
}

function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="toast" role="status" aria-live="polite" onAnimationEnd={onClose}>
      <span className="toast-icon">OK</span>
      <span className="toast-text">{text}</span>
    </div>
  );
}

function Navbar({ mode, uiMode, onToggleUiMode, onLogoClick }: { mode: Mode; uiMode: 'cozy' | 'light'; onToggleUiMode: () => void; onLogoClick: () => void }) {
  return (
    <nav className="navbar">
      <button className="nav-logo" onClick={onLogoClick}>
        Meal<span>OS</span>
        <span className="nav-pill">AI</span>
      </button>
      <div className="nav-actions">
        <button className="nav-theme-btn" onClick={onToggleUiMode}>{uiMode === 'light' ? 'Cozy' : 'Light'}</button>
        <div className="nav-icon-btn" title={mode}>UI</div>
      </div>
    </nav>
  );
}

function Landing({ onSelectMode }: { onSelectMode: (mode: Mode) => void }) {
  const [query, setQuery] = useState('');
  const [activeChip, setActiveChip] = useState<string | null>(null);

  return (
    <section className="landing">
      <div className="landing-eyebrow">Powered by Swiggy</div>
      <h1 className="landing-headline">What do you feel like<br />eating today?</h1>
      <p className="landing-sub">Tell me your mood, craving, or occasion and I will handle the rest.</p>
      <div className="search-bar">
        <span className="search-icon">AI</span>
        <input className="search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. something healthy, spicy biryani, date night" />
        <button className="search-btn" onClick={() => onSelectMode(modeFromQuery(query || ''))}>Go</button>
      </div>
      <div className="chips-row">
        {CHIPS.map((chip) => (
          <button key={chip.id} className={`chip${activeChip === chip.id ? ' active' : ''}`} onClick={() => { setActiveChip(chip.id); onSelectMode(chip.mode); }}>
            <span className="chip-icon">{chip.icon}</span>{chip.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function Instamart() {
  const [selected, setSelected] = useState<Recipe | null>(null);
  const [view, setView] = useState<'list' | 'detail' | 'cook'>('list');
  const [done, setDone] = useState<number[]>([]);

  if (view === 'cook' && selected) {
    const pct = Math.round((done.length / COOKING_STEPS.length) * 100);
    return (
      <div className="flow-screen screen-enter">
        <button className="back-btn" onClick={() => setView('detail')}>Back to recipe</button>
        <h2 className="flow-title">Cook: {selected.name}</h2>
        <div className="progress-bar-container"><div className="progress-bar-fill" style={{ width: `${pct}%` }} /></div>
        <div className="steps-container">
          {COOKING_STEPS.map((s, i) => (
            <div key={s.title + i} className={`step-item${done.includes(i) ? ' done' : ''}`} onClick={() => setDone((p) => p.includes(i) ? p.filter((x) => x !== i) : [...p, i])}>
              <div className="step-num">{done.includes(i) ? 'OK' : i + 1}</div>
              <div className="step-content"><div className="step-title">{s.title}</div><div className="step-detail">{s.detail}</div></div>
              <div className="step-time">{s.time}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (view === 'detail' && selected) {
    return (
      <div className="flow-screen screen-enter">
        <button className="back-btn" onClick={() => setView('list')}>All recipes</button>
        <h2 className="flow-title">{selected.name}</h2>
        <div className="ingredient-grid">
          {INGREDIENTS.map((i) => (
            <div className="ingredient-tag" key={i.name}>
              <img src={i.imageUrl} alt={i.name} width={30} height={30} style={{ borderRadius: 8, objectFit: "cover" }} />
              <div>
                <div>{i.name}</div>
                <div className="ing-qty">{i.qty}</div>
              </div>
            </div>
          ))}
        </div>
        <button className="cta-btn-primary" onClick={() => setView('cook')}>Start Cooking</button>
      </div>
    );
  }

  return (
    <div className="flow-screen screen-enter">
      <div className="flow-header"><div className="section-label">Cook at Home</div><h2 className="flow-title">Recipes for tonight</h2></div>
      <div className="cards-grid">{RECIPES.map((r) => <div className="food-card" key={r.id} onClick={() => { setSelected(r); setView('detail'); }}><div className="card-img"><div className="card-img-stripe" /><PlaceholderVisual title={r.name} subtitle={r.tags.join(" · ")} /></div><div className="card-body"><div className="card-name">{r.name}</div><div className="card-meta"><div className="card-rating">{r.rating}</div><span>{r.time}</span><span className="meta-dot">|</span><span>{r.cal}</span></div><div className="card-footer"><div className="card-price">{r.price}</div><button className="card-cta">View</button></div></div></div>)}</div>
    </div>
  );
}

function Delivery({ onToast }: { onToast: (msg: string) => void }) {
  return <div className="flow-screen screen-enter"><div className="flow-header"><div className="section-label">Order Delivery</div><h2 className="flow-title">Restaurants near you</h2></div><div className="cards-grid">{RESTAURANTS.map((r) => <div className="food-card" key={r.id}><div className="card-img"><div className="card-img-stripe" /><PlaceholderVisual title={r.name} subtitle={r.cuisine} /></div><div className="card-body"><div className="card-name">{r.name}</div><div className="card-meta"><div className="card-rating">{r.rating}</div><span>{r.time}</span><span className="meta-dot">|</span><span>{r.distance}</span></div><div className="card-footer"><div className="card-price">{r.priceFor2}</div><button className="card-cta" onClick={() => onToast(`Opening ${r.name}`)}>Order</button></div></div></div>)}</div></div>;
}

function Dineout({ onToast }: { onToast: (msg: string) => void }) {
  const [selected, setSelected] = useState<DineoutPlace | null>(null);
  if (selected) {
    return <div className="flow-screen screen-enter"><button className="back-btn" onClick={() => setSelected(null)}>Back to list</button><h2 className="flow-title">{selected.name}</h2><p className="flow-sub">{selected.cuisine} | {selected.ambience}</p><div className="dine-card"><div className="dine-img"><div className="card-img-stripe" /><div className="dine-img-text">{selected.name}<br /><span style={{ fontSize: 12, opacity: 0.75 }}>{selected.ambience}</span></div></div></div><div className="booking-panel"><div className="booking-title">Reserve a table</div><div className="time-slots">{['7:00 PM','7:30 PM','8:00 PM','8:30 PM','9:00 PM','9:30 PM'].map((t) => <button className="time-slot" key={t} onClick={() => onToast(`Selected ${t}`)}>{t}</button>)}</div><button className="cta-btn-primary" onClick={() => onToast(`Booked at ${selected.name}`)}>Confirm Reservation</button></div></div>;
  }
  return <div className="flow-screen screen-enter"><div className="flow-header"><div className="section-label">Dine Out</div><h2 className="flow-title">Plan a cozy dinner</h2></div>{DINEOUT_PLACES.map((p) => <div className="dine-card" key={p.id} onClick={() => setSelected(p)}><div className="dine-img"><div className="card-img-stripe" /><div className="dine-img-text">{p.name}<br /><span style={{ fontSize: 12, opacity: 0.75 }}>{p.cuisine}</span></div></div><div className="dine-body"><div className="dine-name">{p.name}</div><div className="dine-meta"><div className="card-rating">{p.rating}</div><span>{p.cuisine}</span><span>{p.availability}</span></div><div className="dine-tags">{p.tags.map((t) => <span className="dine-tag" key={t}>{t}</span>)}</div><div className="dine-footer"><div className="dine-price"><strong>{p.priceFor2}</strong> for 2</div><button className="dine-book-btn">Book</button></div></div></div>)}</div>;
}

function LateNight({ onToast }: { onToast: (msg: string) => void }) {
  return <div className="flow-screen screen-enter"><div className="flow-header"><div className="section-label">Late Night</div><h2 className="flow-title">Still hungry? We are open.</h2></div><div className="cards-grid">{LATENIGHT.map((r) => <div className="food-card" key={r.id}><div className="card-img"><div className="card-img-stripe" /><PlaceholderVisual title={r.name} subtitle={r.cuisine} /></div><div className="card-body"><div className="card-name">{r.name}</div><div className="card-meta"><div className="card-rating">{r.rating}</div><span>{r.time}</span><span className="meta-dot">|</span><span>{r.distance}</span></div><div className="card-footer"><div className="card-price">{r.priceFor2}</div><button className="card-cta" onClick={() => onToast(`Opening ${r.name}`)}>Order</button></div></div></div>)}</div></div>;
}

export default function MealOSApp() {
  const [mode, setMode] = useState<Mode>('landing');
  const [uiMode, setUiMode] = useState<'cozy' | 'light'>('cozy');
  const [toast, setToast] = useState<string | null>(null);
  const theme = THEME_BY_MODE[mode];
  const scrollRef = useRef<HTMLDivElement>(null);

  const content = useMemo(() => {
    if (mode === 'landing') return <Landing onSelectMode={(m) => setMode(m)} />;
    if (mode === 'intent') return <Landing onSelectMode={(m) => setMode(m)} />;
    if (mode === 'instamart') return <Instamart />;
    if (mode === 'delivery') return <Delivery onToast={(msg) => setToast(msg)} />;
    if (mode === 'dineout') return <Dineout onToast={(msg) => setToast(msg)} />;
    return <LateNight onToast={(msg) => setToast(msg)} />;
  }, [mode]);

  return (
    <div className={`app-shell theme-${theme} ui-${uiMode}`}>
      <div className="ambient ambient-1" /><div className="ambient ambient-2" />
      {toast && <Toast text={toast} onClose={() => setToast(null)} />}
      <Navbar mode={mode} uiMode={uiMode} onToggleUiMode={() => setUiMode((p) => p === 'light' ? 'cozy' : 'light')} onLogoClick={() => setMode('landing')} />
      <div className="app-scroll" ref={scrollRef}><div className="content">{content}</div></div>
      {mode !== 'landing' && <button className="mode-tab" onClick={() => setMode('landing')}><span className="mode-tab-label">Current mode</span><span className="mode-tab-name">{mode}</span></button>}
    </div>
  );
}
