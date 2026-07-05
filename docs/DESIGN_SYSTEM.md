# MealOS AI — Design System

**Version 1.0** | Grounded in `src/frontend/mealos/mealos.css` (1,266 lines)

This document is the single source of truth for all visual decisions in MealOS. Every rule here is derived from the existing prototype or is the direct production extension of it. When in doubt, trace back to the CSS variable — never the hex value.

---

## Table of Contents

1. [Foundation](#1-foundation)
   - 1.1 Typography Scale
   - 1.2 Spacing System
   - 1.3 Color System
   - 1.4 Elevation and Depth
2. [Motion and Animation](#2-motion-and-animation)
   - 2.1 Duration Scale
   - 2.2 Easing Reference
   - 2.3 Animation Patterns
   - 2.4 Voice Button Animation
   - 2.5 Planning Graph Animation
   - 2.6 Theme Transition
3. [Component Specifications](#3-component-specifications)
   - 3a. Existing Components
   - 3b. New Components
4. [Layout System](#4-layout-system)
5. [Iconography and Media](#5-iconography-and-media)
6. [Dark Mode / Latenight Mode](#6-dark-mode--latenight-mode)
7. [Implementation Guide](#7-implementation-guide)

---

## 1. Foundation

### 1.1 Typography Scale

MealOS uses two typefaces with strictly defined roles. Never swap them between their designated contexts.

#### Typeface Roles

| Variable | Typeface | Role |
|---|---|---|
| `--font-ui` | DM Sans, sans-serif | All body text, labels, UI chrome, navigation, buttons, chips, metadata |
| `--font-display` | Playfair Display, serif | Dineout mode headlines only — `.theme-dineout .flow-title`, `.theme-dineout .dine-name`, and nowhere else |

Playfair Display is never used for UI chrome, buttons, or any functional element. It signals the premium/romantic register of Dineout mode.

#### DM Sans Scale (UI Font)

All sizes use `--font-ui`. Line-height and letter-spacing values are production defaults.

| Name | Font Size | Line Height | Font Weight | Letter Spacing | Usage |
|---|---|---|---|---|---|
| `xs` | 10px | 1.4 | 600–700 | +0.06em to +0.12em | Badges, mode-badge, section labels in ALL CAPS |
| `sm` | 11–12px | 1.4 | 500–700 | +0.02em to +0.10em | Card meta, muted labels, chip sub-labels, step-time |
| `base` | 13–14px | 1.4–1.5 | 400–600 | 0 to +0.01em | Body copy, strip text, step-detail, filter chips, toast text |
| `md` | 15–16px | 1.5–1.6 | 400–700 | 0 to -0.01em | Search input, card names, CTA buttons, landing-sub |
| `lg` | 17–18px | 1.4 | 600–700 | -0.01em to -0.02em | Nav logo, dine-name (non-dineout), booking-title |
| `xl` | 22–24px | 1.2–1.3 | 700 | -0.02em | Flow titles (mobile), intent headings (mobile) |
| `2xl` | 28–32px | 1.1–1.2 | 700 | -0.02em | Flow titles (desktop) |
| `3xl` | 38–42px | 1.1 | 700 | -0.02em | Intent heading (desktop), hero sub-headings |
| `4xl` | 48–58px | 1.1 | 700 | -0.02em | Landing headline (`clamp(32px, 6vw, 58px)`) |

All sizes from `xl` upward use `clamp()` to scale between mobile and desktop. Never fix a large heading size without a clamp.

#### Section Labels (Special Case)

Section labels (`font-size: 11px, font-weight: 700, letter-spacing: 0.10em, text-transform: uppercase`) are a distinct pattern — xs size, forced uppercase, wide tracking. They use `var(--text-muted)` exclusively.

#### Display Scale (Playfair Display)

Only applied inside `.theme-dineout`.

| Usage | Size | Weight | Style |
|---|---|---|---|
| `.flow-title` (dineout) | clamp(22px, 4vw, 30px) | 700 | Normal |
| `.dine-name` | 18px | 700 | Normal |
| Image placeholder text (`.dine-img-text`) | 14px | 400 | Italic |

#### Letter-Spacing Rules

- **Negative tracking** (`-0.01em` to `-0.02em`): headings, titles, prices, anything large and bold. Tighter tracking makes large text feel cohesive.
- **Zero tracking**: body copy, button labels at 15px+.
- **Positive tracking** (`+0.01em` to +`0.12em`): small all-caps labels, badges, nav-pill, eyebrow text. Wider tracking compensates for small size.
- Never apply negative letter-spacing below 14px.

#### `text-wrap: pretty`

Apply `text-wrap: pretty` to multiline headings and paragraph text that may hyphenate or break awkwardly at narrow viewports. Required on: `.landing-headline`, `.intent-heading`, `.flow-title`. Not needed on single-line text or short labels.

---

### 1.2 Spacing System

Base unit: **4px**. All spacing values are multiples of this unit.

| Token | Value | Usage |
|---|---|---|
| `space-1` | 4px | Icon gap within labels, tight inline spacing |
| `space-2` | 8px | Gap between chip icon and label, card meta dots, ingredient gap |
| `space-3` | 12px | Nav internal gap, search bar gap, step detail margin |
| `space-4` | 16px | Standard internal card padding, step padding, chip row gap, section label margin-bottom, grid gap |
| `space-5` | 20px | Navbar horizontal padding (partial), chip row max-width padding |
| `space-6` | 24px | Flow screen horizontal padding, section divider margin, booking panel padding, sticky CTA padding, content padding |
| `space-8` | 32px | Flow header margin-bottom, steps container margin, cards grid margin |
| `space-10` | 40px | Landing margin-bottom for sub |
| `space-12` | 48px | Landing/intent screen vertical padding, flow header top spacing |
| `space-16` | 64px | (available but not in prototype — reserve for section breaks on marketing pages) |
| `space-20` | 80px | (available — reserve for very large vertical rhythms) |

#### Layout Context Mapping

| Context | Spacing |
|---|---|
| Component internal padding (small) | `space-3` (12px) – `space-4` (16px) |
| Component internal padding (large) | `space-4` (16px) – `space-6` (24px) |
| Gap between sibling cards | `space-4` (16px) |
| Section top/bottom margin | `space-8` (32px) |
| Screen horizontal padding | `space-6` (24px) |
| Screen vertical padding | `space-12` (48px) |
| Navbar height | 56px (fixed — not a spacing token, a structural constant) |
| Sticky CTA bottom area | 100px (bottom safe area) |

#### Touch Targets

Every interactive element must be at least **44×44px** in its tappable area. If the visual element is smaller (e.g., `.card-fav` at 30×30px), add padding or an invisible tap target wrapper to reach 44px. Navigation icon buttons are 36×36px visual — they need a 4px padding wrapper on mobile.

---

### 1.3 Color System

All colors are consumed exclusively through CSS custom properties. Hardcoded hex values are forbidden in component stylesheets.

#### Theme Token Sets

Each theme class on `.app-shell` defines the full set of semantic tokens. Components reference these tokens — never theme-specific values.

| Token | neutral | instamart | delivery | dineout | latenight |
|---|---|---|---|---|---|
| `--bg` | `#f8f6f3` | `#f6f8f3` | `#f8f6f3` | `#f8f5f1` | `#0f0e1a` |
| `--bg2` | `#f2efea` | `#eef2e9` | `#f3efe9` | `#f2ece5` | `#16152a` |
| `--bg3` | `#ebe7e1` | `#e4ebdd` | `#ece5db` | `#ece3d8` | `#1e1c38` |
| `--surface` | `#ffffff` | `#ffffff` | `#ffffff` | `#fffdfb` | `#1a1830` |
| `--surface2` | `#f9f7f4` | `#f5f8f2` | `#faf8f4` | `#f7f2eb` | `#201e38` |
| `--border` | `#e5dfd7` | `#d7e2cf` | `#e4d9cd` | `#e0d5c7` | `#2e2c50` |
| `--text-primary` | `#26211d` | `#243125` | `#2b221b` | `#2f241a` | `#e8e4f8` |
| `--text-secondary` | `#6f665d` | `#627065` | `#6f5f4e` | `#6f5d4c` | `#9890c8` |
| `--text-muted` | `#9f968c` | `#8e9f90` | `#9f9080` | `#988470` | `#5a5480` |
| `--accent` | `#c68e69` | `#7c9b79` | `#c48a63` | `#b38a63` | `#7c6fcd` |
| `--accent-soft` | `#f6eee8` | `#edf4ec` | `#f7eee8` | `rgba(179,138,99,0.14)` | `rgba(124,111,205,0.15)` |
| `--accent-text` | `#8f6247` | `#4e694c` | `#8b5f43` | `#7d5b3d` | `#a899e8` |
| `--chip-bg` | `#f0ebe4` | `#e8f0e6` | `#efe7de` | `#efe5da` | `#201e38` |
| `--chip-active` | `#4e433a` | `#5d745b` | `#7a6757` | `#8f6d4f` | `#7c6fcd` |
| `--chip-active-text` | `#faf9f7` | `#ffffff` | `#ffffff` | `#fffaf5` | `#ffffff` |
| `--nav-bg` | `rgba(248,246,243,0.93)` | `rgba(246,248,243,0.93)` | `rgba(248,246,243,0.93)` | `rgba(248,245,241,0.94)` | `rgba(15,14,26,0.92)` |
| `--ambient-1` | `rgba(198,142,105,0.06)` | `rgba(124,155,121,0.08)` | `rgba(196,138,99,0.08)` | `rgba(179,138,99,0.08)` | `rgba(124,111,205,0.08)` |
| `--ambient-2` | `rgba(198,142,105,0.04)` | `rgba(180,154,120,0.05)` | `rgba(156,130,108,0.05)` | `rgba(179,138,99,0.04)` | `rgba(124,111,205,0.04)` |

#### Semantic Color Roles

**Background Hierarchy** (depth increases as you descend):

```
--bg          Page canvas — app shell background
  --bg2       Subtle wells, section dividers, skeleton base
    --bg3     Recessed areas, image placeholders, progress track
      --surface     Cards, modals, panels — white in light themes
        --surface2  Secondary surfaces within a card (footers, sidebars)
```

Components that live "above" the page use `--surface`. Components nested inside another surface use `--surface2`. Never use `--bg` for a card that sits on `--bg`.

**Text Hierarchy**:

```
--text-primary    Headings, card names, prices, active labels
--text-secondary  Body copy, descriptions, metadata
--text-muted      Timestamps, helper text, empty states, section labels
```

Text at any given level must never be used in a context that demands higher prominence. If a label appears on a colored surface (e.g., `--accent-soft`), use `--accent-text` rather than `--text-primary`.

**Accent Colors**:

- `--accent` — fill for primary buttons, active chips, step numbers, progress bar, AI dot, logo accent character. Use sparingly.
- `--accent-soft` — backgrounds for accent-tinted regions (tags, intent-tag, search focus ring layer, selected time slots). Always paired with `--accent-text`.
- `--accent-text` — text or icons placed on `--accent-soft` backgrounds. Never place `--accent-text` on `--surface`.
- `--chip-active` / `--chip-active-text` — active/selected chip state. `--chip-active` tends to be darker than `--accent` to ensure chip legibility.

Rule: **never use a raw hex value in any component file**. Every color reference must be `var(--token-name)`.

#### Accessibility — Minimum Contrast Ratios

| Role pairing | Minimum ratio | WCAG level |
|---|---|---|
| `--text-primary` on `--bg` | 7:1 | AAA |
| `--text-secondary` on `--bg` | 4.5:1 | AA |
| `--text-muted` on `--bg` | 3:1 | AA Large |
| `--chip-active-text` on `--chip-active` | 4.5:1 | AA |
| White on `--accent` (button label) | 3:1 minimum | AA Large |
| `--accent-text` on `--accent-soft` | 4.5:1 | AA |

Validate latenight theme separately — see Section 6.

---

### 1.4 Elevation and Depth

Three shadow levels correspond to three visual elevations. Components are assigned a level based on their resting state.

| Level | Token | Value | Used when |
|---|---|---|---|
| 1 — Card | `--shadow-card` | `0 2px 12px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.05)` | Cards at rest on hover-triggered lift (`chip:hover`), AI banner hover |
| 2 — Elevated | `--shadow-elevated` | `0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)` | Cards on hover (`food-card:hover`, `dine-card:hover`), search bar at rest, booking panel, mode-tab, sticky CTA btn hover |
| 3 — Float | `--shadow-float` | `0 16px 48px rgba(0,0,0,0.16), 0 4px 12px rgba(0,0,0,0.08)` | Toasts, modals, mode-tab on hover, overlays |

Pattern for interactive cards: resting shadow = none or `--shadow-card`, hover shadow = `--shadow-elevated`. Reserve `--shadow-float` for elements that break out of the normal document flow (fixed-position overlays, toast notifications).

#### Ambient Orbs

Ambient orbs are large blurred circles (`filter: blur(80px)`, `pointer-events: none`, `z-index: 0`) positioned at the top-right and bottom-left corners of the viewport. They are defined by `--ambient-1` and `--ambient-2` per theme.

- `.ambient-1`: 600×600px, top: -200px, right: -100px
- `.ambient-2`: 400×400px, bottom: -100px, left: -100px

Orbs use `transition: all 800ms var(--ease-smooth)` — they transition more slowly than the UI itself (500ms) to feel atmospheric rather than mechanical. Add ambient orbs to every full-screen view. Do not add them inside individual components.

---

## 2. Motion and Animation

### 2.1 Duration Scale

| Category | Duration | Use cases |
|---|---|---|
| Instant | 0ms | Hover text color changes where any delay feels laggy |
| Fast | 150–200ms | Button press scale feedback (`:active`), selection state fill, card-fav hover scale, nav-icon-btn hover, filter-chip hover border |
| Standard | 250–350ms | Chip hover lift + shadow, card hover lift + shadow, AI banner hover, mode card hover, search bar focus ring |
| Deliberate | 400–500ms | Screen enter (`screen-enter`), theme color transitions on `.app-shell`, progress bar fill |
| Long | 600–800ms | Landing page staggered reveals (six sequential fadeUp animations at 200ms, 350ms, 450ms, 550ms, 650ms, 750ms delays), ambient orb transitions (800ms) |

Never use a duration longer than 800ms for any user-triggered interaction. Durations above 800ms are reserved for background/atmospheric transitions only.

---

### 2.2 Easing Reference

| Token | Curve | Behavior | Use for |
|---|---|---|---|
| `--ease-smooth` | `cubic-bezier(0.4, 0, 0.2, 1)` | Standard Material-style in/out, no overshoot | Card hover lift, theme transitions, sidebar slides, progress bar, screen-enter, all page-level transitions |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Bouncy — overshoots target then settles | Chip press, button tap (`:active` bounce), voice button expand, toast slide-in, planning graph checkmark appearance, mode icon on hover |

`--ease-spring` must never be used for page-level transitions (screen-enter, route changes). Its overshoot creates visual instability at page scale. Restrict it to small, contained elements where the bounce reads as playful responsiveness.

---

### 2.3 Animation Patterns

#### Defined Keyframes

| Name | Keyframe | Default timing |
|---|---|---|
| `fadeUp` | `opacity: 0, translateY(16px)` → `opacity: 1, translateY(0)` | 400–600ms, `ease-smooth`, `forwards` |
| `fadeIn` | `opacity: 0` → `opacity: 1` | 300ms, `ease-smooth`, `forwards` |
| `shimmer` | Gradient sweep: `background-position: 200% 0` → `-200% 0` | 1.5s, `linear`, `infinite` |
| `pulse` | `scale(1), opacity: 1` → `scale(1.4), opacity: 0.7` → back | 2s, `ease-in-out`, `infinite` |
| `slideUp` | `opacity: 0, translateY(32px)` → `opacity: 1, translateY(0)` | 500ms, `ease-smooth`, `forwards` |
| `slideToast` | `translateX(120%), opacity: 0` → `translateX(0), opacity: 1` | 300ms, `ease-spring`, `forwards` |

Always use `animation-fill-mode: forwards` on any animation that transitions an element from invisible to visible. Without it, the element snaps back to opacity 0 when the animation completes.

#### Screen Enter

Every routed screen or major section swap uses:

```css
.screen-enter {
  animation: fadeUp 400ms var(--ease-smooth) forwards;
}
```

Apply this class to the top-level container of each screen view. Remove it (and re-add) when transitioning to ensure the animation re-fires. React idiom: key the container on the route path.

#### Staggered List Reveals

For lists of cards or items that appear on screen load:

- Apply `animation-delay: calc(var(--i, 0) * 100ms)` where `--i` is a CSS custom property set inline on each item.
- Maximum stagger: 5 items (0ms, 100ms, 200ms, 300ms, 400ms). Items beyond index 4 appear at 0ms delay with the last stagger value — never delay past 400ms.
- Each item uses `fadeUp 400ms ease-smooth forwards`.

#### Skeleton Loading

Apply `.skeleton` class to placeholder elements during data fetches:

```css
.skeleton {
  background: linear-gradient(90deg, var(--bg2) 25%, var(--bg3) 50%, var(--bg2) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
  border-radius: 8px;
}
```

Size skeleton elements to match the actual content dimensions to prevent layout shift on load.

#### AI Pulse Dot

The pulsing orb on the AI banner and AI strip avatar:

```css
.ai-dot {
  animation: pulse 2s infinite;
}
```

The dot is `8px` diameter, `border-radius: 50%`, `background: var(--accent)`. It scales to 1.4× at the midpoint. This pattern signals live AI activity — use it only when the AI is genuinely active or listening.

---

### 2.4 Voice Button Animation

The VoiceButton component has four distinct states, each with its own animation.

**Idle**: Circular button, accent fill (`background: var(--accent)`), white microphone icon, no animation. Size: 48×48px minimum (exceeds 44px touch target).

**Listening**: A ring element (positioned absolutely outside the button boundary) expands and fades:
```css
@keyframes voiceRing {
  0%   { transform: scale(1);   opacity: 0.6; }
  100% { transform: scale(1.8); opacity: 0; }
}
.voice-ring {
  animation: voiceRing 1.2s var(--ease-smooth) infinite;
}
```
Button background shifts to a slightly lighter `--accent` tint. Ring color: `var(--accent)`. Run two rings staggered by 0.6s for a continuous expanding-pulse effect.

**Processing**: The microphone icon is replaced by a spinner (CSS border-based or SVG). Spinner color: white on `--accent` background. Animation: `spin 600ms linear infinite`. Button remains the same size.

**Error**: Button background flashes `#ef4444` (semantic error red — this is the one exception to the no-hardcoded-hex rule, as error states are not theme-variable). Duration: 200ms. Then return to idle state. No ARIA alert needed for the visual flash; pair with a toast notification for the accessible error message.

---

### 2.5 Planning Graph Animation

The PlanningGraph shows a horizontal or vertical sequence of step nodes that animate as planning progresses via SSE events.

**Node — Default State**:
- Circle: `border: 2px solid var(--border)`, fill: `var(--bg2)`, `opacity: 0.5`
- Label: `var(--text-muted)`, `font-size: 12px`

**Node — Running State** (current step):
- Subtle opacity pulse: `opacity: 0.6` → `1`, looping at 800ms, `ease-in-out`
- Border color: `var(--accent)`, `border-width: 2px`
- Label: `var(--text-secondary)`

**Node — Complete State** (on `step_complete` SSE event):
1. Circle fills with `var(--accent)` — `transition: background 150ms var(--ease-smooth), border-color 150ms var(--ease-smooth)`
2. Checkmark SVG appears inside — scales from `scale(0)` to `scale(1)` over 200ms with `var(--ease-spring)`, white stroke on accent fill
3. Label changes to `var(--text-primary)`, `font-weight: 600`

**Node — Error State**:
- Circle fill: `#ef4444` (semantic red), border: `#ef4444`
- × mark (white, centered), static — no animation
- Label: `var(--text-muted)`, `font-style: italic`

**Connector Lines** (between nodes):
- Inactive: `background: var(--border)`, `height: 2px`
- Active (step before it is complete): fills left-to-right with `var(--accent)`, `transition: width 300ms var(--ease-smooth)`

---

### 2.6 Theme Transition

When the user's situation type changes (e.g., sick → delivery, romantic → latenight), the `.app-shell` class is updated and CSS transitions handle the visual shift:

```css
.app-shell {
  transition: background 500ms var(--ease-smooth), color 500ms var(--ease-smooth);
}
```

The navbar and sticky CTA also carry matching transitions on `background` and `border-color` at 500ms. Ambient orbs use a slower 800ms transition to feel atmospheric. All other elements (cards, chips, borders) inherit the theme tokens instantly — they do not need individual transition declarations unless a specific element requires an override.

---

## 3. Component Specifications

### 3a. Existing Components

---

#### Navbar

**Purpose**: Fixed top bar providing navigation, brand identity, theme indicator, and global actions.

**Visual Description**: 56px tall, full viewport width, frosted glass via `backdrop-filter: blur(16px)`. Contains the MealOS logo (left), an optional mode pill (center-left), and action buttons (right: theme switcher, icon buttons).

**States**:
- Default: `background: var(--nav-bg)` at 93% opacity, `border-bottom: 1px solid var(--border)`
- Theme transition: smooth 500ms crossfade of background and border-color when mode changes
- No separate hover state on the bar itself

**Props (conceptual)**: current theme name, mode pill label, action button list, back handler

**Dimensions**: Width: 100vw. Height: 56px fixed. Internal padding: 0 24px.

**Spacing**: Logo gap: 8px (icon to text). Actions gap: 12px between buttons.

**Responsive Behavior**: On mobile, collapse the theme-switcher button label to an icon only if viewport < 400px. Logo always visible.

**Theme Sensitivity**: `--nav-bg`, `--border`, `--text-primary`, `--accent`, `--accent-soft`, `--accent-text`, `--surface2`

**Animation**: `transition: background 500ms var(--ease-smooth), border-color 500ms var(--ease-smooth)` on the bar. Logo accent character: `transition: color 400ms`.

**Accessibility**: `role="banner"`, `aria-label="MealOS navigation"`. Logo button: `aria-label="Go to home"`. Theme button: `aria-label="Switch theme"`. All icon buttons must have `aria-label`. `z-index: 100`.

---

#### FoodCard

**Purpose**: Displays a single food or dish recommendation with image, name, metadata, price, and a CTA.

**Visual Description**: Surface card with `border-radius: var(--radius-lg)` (24px). Top: image area (140px height, 16:9 effective via fixed height). Below: card body with name, meta row (cuisine type · time · rating badge), price + CTA button.

**States**:
- Default: `background: var(--surface)`, `border: 1px solid var(--border)`, no shadow
- Hover: `transform: translateY(-3px)`, `box-shadow: var(--shadow-elevated)`, `border-color: var(--accent)`
- Selected (if applicable): accent border + accent-soft ring
- Loading: SkeletonLoader overlaid at image area and two text rows

**Props (conceptual)**: dish name, cuisine tags, prep time, rating, price, image URL (optional), on-click handler

**Dimensions**: Width: fills grid column (min 240px). Image height: 140px fixed. No fixed card height — varies by content.

**Spacing**: Card body padding: 14px. Meta row margin-bottom: 10px. Footer: flex space-between.

**Responsive Behavior**: At mobile (<600px), cards stack to full-width single column. Image height stays 140px.

**Theme Sensitivity**: `--surface`, `--border`, `--accent`, `--bg3` (image placeholder), `--text-primary`, `--text-secondary`, `--text-muted`

**Animation**: Hover: `transform translateY(-3px)` + shadow at 300ms `ease-smooth`. CTA button: `scale(1.03)` on hover (200ms), `scale(0.97)` on active (150ms).

**Accessibility**: `role="article"`, `aria-label="[dish name] — ₹[price]"`. CTA button: `aria-label="Order [dish name]"`. Rating badge: `aria-label="Rating: [value] out of 5"`. Keyboard: Enter/Space activates card.

---

#### Chip

**Purpose**: Suggestion or filter pill for quick query selection on the landing screen.

**Visual Description**: Rounded pill (`border-radius: 20px`). Contains optional icon (emoji or glyph) + label text. Two variants: landing suggestion chips (larger, 10px 18px padding) and filter chips in a scrollable row (8px 16px padding).

**States**:
- Default: `background: var(--chip-bg)`, `color: var(--text-secondary)`, `border: 1px solid var(--border)`
- Hover (suggestion chip): `background: var(--chip-active)`, `color: var(--chip-active-text)`, `border-color: var(--chip-active)`, `transform: translateY(-2px)`, `box-shadow: var(--shadow-card)`
- Hover (filter chip): `border-color: var(--accent)`, `color: var(--accent)` (no background change)
- Active/Selected: `background: var(--chip-active)`, `color: var(--chip-active-text)`, `border-color: var(--chip-active)`

**Props (conceptual)**: label, icon (optional), selected state, on-click handler

**Dimensions**: Height: minimum 44px on mobile for touch compliance (adjust padding). Width: auto (white-space: nowrap).

**Spacing**: Suggestion chip padding: 10px 18px. Filter chip padding: 8px 16px. Icon gap: 8px.

**Responsive Behavior**: Chips row wraps on landing. Filter chips row scrolls horizontally (`overflow-x: auto`, hidden scrollbar).

**Theme Sensitivity**: `--chip-bg`, `--chip-active`, `--chip-active-text`, `--border`, `--accent`, `--text-secondary`

**Animation**: Suggestion chip hover: `translateY(-2px)` + shadow at 250ms `ease-smooth`. Filter chip hover: border/color at 200ms. Active chip press: `scale(0.97)` at 150ms `ease-spring`.

**Accessibility**: `role="button"`, `aria-pressed="true/false"` for filter chips. `tabindex="0"`. Keyboard: Enter/Space toggles. For a scrollable chips row, ensure keyboard focus scrolls the container.

---

#### SearchBar

**Purpose**: Primary text input for the landing page query entry.

**Visual Description**: Wide pill container (`border-radius: var(--radius-xl)` = 32px) with search icon (left), text input (center, flexible), and a Submit button (right, smaller rounded pill inside the bar).

**States**:
- Default: `background: var(--surface)`, `border: 1.5px solid var(--border)`, `box-shadow: var(--shadow-elevated)`
- Focus-within: `border-color: var(--accent)`, outer glow ring: `0 0 0 4px var(--accent-soft)` + `var(--shadow-elevated)`
- Submit button hover: `opacity: 0.9`, `scale(1.02)`
- Submit button active: `scale(0.98)`

**Props (conceptual)**: placeholder text, value, on-change, on-submit

**Dimensions**: Max-width: 560px. Width: 100% up to max. Height: auto (padding 14px 20px sets it ~52px). Input: `font-size: 16px` (prevents iOS zoom).

**Spacing**: Internal gap: 12px. Padding: 14px 20px. Submit button padding: 8px 18px.

**Responsive Behavior**: Full width on mobile. Placeholder shortens naturally. Submit button label may shorten at very small viewports.

**Theme Sensitivity**: `--surface`, `--border`, `--accent`, `--accent-soft`, `--text-primary`, `--text-muted`, `--shadow-elevated`

**Animation**: Focus transition: 300ms `ease-smooth` for border-color and box-shadow.

**Accessibility**: `role="search"`. Input: `aria-label="What do you want to eat?"`. Submit: `type="submit"`, `aria-label="Search"`. Entire bar is keyboard accessible — Tab to input, Tab again to submit button.

---

#### StepItem (Cooking Step)

**Purpose**: One item in a numbered cooking instruction list, with completion toggle.

**Visual Description**: Horizontal layout — numbered circle (left, 28×28px), step content (center, flexible), time estimate (right). Separated from siblings by a bottom border. When marked done: number circle fills with accent, title gets strikethrough, color dims to muted.

**States**:
- Default: circle `background: var(--chip-bg)`, `color: var(--text-secondary)`, title in `--text-primary`
- Done: circle `background: var(--accent)`, `color: #fff`, title strikethrough in `--text-muted`
- Last item: no bottom border

**Props (conceptual)**: step number, step title, step detail (longer instruction), time estimate, done state, on-toggle

**Dimensions**: Width: full container. Circle: 28×28px. Min height: 56px (ensures 44px touch for the toggle area).

**Spacing**: Top/bottom padding: 16px. Left gap (circle to content): 16px.

**Responsive Behavior**: No layout change — already single column. Text wraps naturally.

**Theme Sensitivity**: `--chip-bg`, `--accent`, `--border`, `--text-primary`, `--text-muted`, `--text-secondary`

**Animation**: Circle fill transition: 300ms `ease-smooth`. Title strikethrough appears with `transition: text-decoration 150ms`.

**Accessibility**: `role="listitem"`. Checkbox pattern: toggle button `aria-pressed="true/false"`, `aria-label="Mark step [N] done"`. Screen reader announces step title when focused.

---

#### Toast

**Purpose**: Non-blocking notification that slides in from the right and auto-dismisses.

**Visual Description**: Fixed-position card (top: 70px, right: 20px). Contains icon (left), message text (right). Rounded corners `var(--radius-md)`. Floats above all content via `--shadow-float` and `z-index: 200`.

**States**:
- Enter: `slideToast 300ms var(--ease-spring) forwards` (slides in from right)
- Visible: static
- Exit: fade out or slide back (reverse of enter — implement with `animation-direction: reverse` or an exit keyframe)
- Variants: default (info), success (checkmark icon), error (warning icon)

**Props (conceptual)**: icon, message text, duration (default 3000ms), type (info/success/error)

**Dimensions**: Min-width: 240px. Max-width: 320px. Height: auto (padding 12px 16px).

**Spacing**: Internal gap: 10px. Padding: 12px 16px.

**Responsive Behavior**: On mobile (<360px), stretch to `calc(100vw - 32px)` anchored at right: 16px.

**Theme Sensitivity**: `--surface`, `--border`, `--text-primary`, `--shadow-float`

**Animation**: Enter: `slideToast 300ms ease-spring forwards`. Never show more than 3 toasts simultaneously — queue them.

**Accessibility**: `role="status"` for info/success. `role="alert"` for error (announces immediately). `aria-live="polite"` on the toast container. Include an accessible close button (`aria-label="Dismiss"`). Auto-dismiss must pause on hover/focus.

---

#### ProgressBar

**Purpose**: Linear fill indicator showing completion progress of a flow or process.

**Visual Description**: Full-width thin bar (4px height). Track: `var(--bg3)`. Fill: `var(--accent)`. Both sides rounded (`border-radius: 4px`).

**States**:
- Empty: fill width 0%
- Partial: fill transitions to percentage
- Complete: fill at 100% — optionally flash accent-soft as a completion signal

**Props (conceptual)**: value (0–100), aria-label

**Dimensions**: Width: 100% of container. Height: 4px. No explicit height override needed.

**Spacing**: `margin-bottom: 8px` below the bar before any label text.

**Responsive Behavior**: Inherits container width — no special behavior needed.

**Theme Sensitivity**: `--bg3`, `--accent`

**Animation**: Fill: `transition: width 500ms var(--ease-smooth)`. Do not use spring on progress bar — smooth linear fill feels more informative.

**Accessibility**: `role="progressbar"`, `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-label` describing what is progressing.

---

#### SkeletonLoader

**Purpose**: Placeholder elements during async data loading to prevent layout shift and reduce perceived wait time.

**Visual Description**: Rounded rectangles or circles with a left-to-right shimmer sweep. Colors use theme background tokens so they blend naturally.

**States**:
- Active: `animation: shimmer 1.5s infinite`
- Done: component is removed from DOM — replaced by real content

**Props (conceptual)**: shape (rect/circle), width, height — composition of multiple skeletons mirrors the real component layout

**Dimensions**: Must match the real content's dimensions as closely as possible. For FoodCard: image skeleton 140px height, name skeleton 16px height 60% width, meta skeleton 12px height 40% width.

**Spacing**: Inherited from the component it stands in for.

**Responsive Behavior**: Inherits container width.

**Theme Sensitivity**: `--bg2` (base), `--bg3` (shimmer highlight)

**Animation**: `shimmer 1.5s linear infinite`. Use `background-size: 200% 100%` for the sweep.

**Accessibility**: `aria-hidden="true"`. The loading container should have `aria-busy="true"` and `aria-label="Loading..."` at the section level.

---

### 3b. New Components

---

#### ConfidenceCard

**Purpose**: Displays how confident the AI is about its understanding of the user's request, listing known and unknown fields.

**Visual Description**: Surface card with two columns: a circular confidence score dial or percentage on the left (large, accent-colored), and a structured list on the right split into "Known" (checkmarks, `--text-primary`) and "Unknown / Clarifying" (dash or question mark, `--text-muted`). A subtle `--accent-soft` background wash at the top of the card signals AI origin. Border: `var(--border)`.

**States**:
- High confidence (>85%): accent-colored score, minimal unknown fields shown
- Medium confidence (60–85%): score in `--text-secondary`, several unknowns listed
- Low confidence (<60%): score in amber/muted, most fields unknown, card prompts clarification
- Loading: skeleton with circular skeleton (left) and two-row list skeleton (right)

**Props (conceptual)**: score (0–100), known fields (array of strings), unknown fields (array of strings), on-clarify handler

**Dimensions**: Width: full container (max 800px flow screen). Height: auto, min 80px. Padding: 16px 20px.

**Spacing**: Left dial section width: 72px. Gap between dial and list: 16px. List item gap: 6px.

**Responsive Behavior**: On mobile, stack dial above the field lists. Single column.

**Theme Sensitivity**: `--surface`, `--border`, `--accent`, `--accent-soft`, `--accent-text`, `--text-primary`, `--text-muted`

**Animation**: Entry: `fadeUp 400ms ease-smooth forwards` with `.screen-enter`. Confidence score count-up animation: JavaScript-driven number increment over 600ms on mount.

**Accessibility**: `role="region"`, `aria-label="AI confidence assessment"`. Score: `aria-label="Confidence score: [N]%"`. Lists: `role="list"` with `role="listitem"` per field.

---

#### ClarificationCard

**Purpose**: Presents a smart follow-up question from the AI with quick-tap option buttons so the user can respond without typing.

**Visual Description**: Surface card, slightly wider internal padding. Top: AI avatar dot (8px pulse) + question text in `--text-primary`, `font-size: 15px`, `font-weight: 600`. Below the question: a row (or wrapping set) of option buttons — styled like filter chips but slightly larger. Optional free-text input below the options for custom answers.

**States**:
- Idle: question visible, options un-selected
- Option hovered: chip hover state (accent border + color)
- Option selected: chip active state (`--chip-active` fill), triggers auto-submit or enables a Continue button
- Answered: card dims to `opacity: 0.6`, answer appears as a confirmation label above the card

**Props (conceptual)**: question text, options (array of strings), selected option, on-select handler, allow-free-text flag

**Dimensions**: Width: full container. Height: auto. Padding: 20px. Options row gap: 8px.

**Spacing**: Question margin-bottom: 16px. Options to free-text input gap: 12px.

**Responsive Behavior**: Options wrap to multiple rows on mobile. Free-text input is full-width on mobile.

**Theme Sensitivity**: `--surface`, `--border`, `--accent`, `--chip-bg`, `--chip-active`, `--chip-active-text`, `--text-primary`, `--text-secondary`

**Animation**: Entry: `fadeUp 400ms ease-smooth forwards`. Option select: `scale(0.97)` press (150ms `ease-spring`). Answered state: `transition: opacity 300ms ease-smooth`.

**Accessibility**: `role="group"`, `aria-labelledby` pointing to the question text. Options: `role="radio"` within a `role="radiogroup"`, or `role="button"` with `aria-pressed`. Keyboard: arrow keys navigate options if they are radio-style.

---

#### PlanningGraph

**Purpose**: A step-by-step progress visualization that lights up nodes in real-time as the AI planning pipeline executes.

**Visual Description**: Horizontal sequence of labeled nodes connected by lines (desktop). On mobile, vertical stacked list. Each node is a circle (24–32px diameter) with a step label beneath. Connector: a 2px line between nodes that fills left-to-right as steps complete. The current running node has a subtle pulse.

**States**: See Section 2.5 (Planning Graph Animation) for full state descriptions — default, running, complete, error.

**Props (conceptual)**: steps (array of `{id, label, status: 'pending'|'running'|'complete'|'error'}`), current step index

**Dimensions**: Width: full container. Node diameter: 28px. Connector line height: 2px. Label font-size: 11px. Vertical spacing (mobile): 32px per node.

**Spacing**: Node gap (horizontal): 48px minimum. Label margin-top: 6px.

**Responsive Behavior**: Horizontal on tablet/desktop (≥600px). Vertical stacked list on mobile — nodes align left, labels to the right of the node.

**Theme Sensitivity**: `--border`, `--bg2`, `--accent`, `--text-muted`, `--text-primary`

**Animation**: Per Section 2.5. Connector line: `transition: width 300ms ease-smooth`.

**Accessibility**: `role="list"`, `aria-label="Planning progress"`. Each node: `role="listitem"`, `aria-label="Step [N]: [label] — [status]"`. Live updates: wrap the graph in `aria-live="polite"` so screen readers announce step completions.

---

#### ComparisonTable

**Purpose**: Side-by-side comparison of Cook, Order (Delivery), and Dine Out options with scores and key metadata per category.

**Visual Description**: Three-column table. Header row: mode names with their accent colors. Body rows: criteria labels (left) with values per mode. Winning cells are highlighted with `--accent-soft` background and `--accent-text` text. A footer row shows a total score or composite rating. Borders: `var(--border)` for row separators and column dividers.

**States**:
- Default: all columns equally weighted
- Recommended column: light `--accent-soft` column tint, slight `box-shadow` to lift it
- Loading: skeleton for each cell

**Props (conceptual)**: modes (array of mode data), criteria (array of `{label, values[3], winner}`), recommended mode index

**Dimensions**: Width: full container. Min-width: 320px. Each column: equal width (1fr). Row height: auto (min 40px). Padding per cell: 10px 12px.

**Spacing**: Header padding: 12px. Cell padding: 10px 12px. No external margin needed — flow screen provides it.

**Responsive Behavior**: On mobile (<480px), switch to a stacked card layout — one card per mode, criteria listed vertically. The table layout is desktop/tablet only.

**Theme Sensitivity**: `--surface`, `--border`, `--accent`, `--accent-soft`, `--accent-text`, `--text-primary`, `--text-secondary`, `--text-muted`

**Animation**: Entry: `fadeUp 400ms ease-smooth forwards`. Winner highlight: `transition: background 300ms ease-smooth` when data loads.

**Accessibility**: `role="table"`. Header cells: `role="columnheader"`. Data cells: `role="cell"`. Winner cells: `aria-label="[criterion]: [value] — Best option"`. On mobile stack layout, use `role="list"` and `role="listitem"` per mode card.

---

#### DecisionCard

**Purpose**: Presents the AI's final recommended action — the "winner" of the Cook/Order/Dine analysis — with a clear title and explanatory text.

**Visual Description**: Prominent surface card with a left accent bar (4px wide, `--accent` color, full card height via `border-left`). Header: "AI Recommendation" label (section-label style) + mode name in large bold text. Below: two or three sentence explanation in `--text-secondary`. Optional action button at the bottom.

**States**:
- Default: static display
- No recommendation (edge case): dimmed card with "Insufficient data" message in `--text-muted`

**Props (conceptual)**: recommended mode, mode label, explanation text, confidence score, action button label, on-action handler

**Dimensions**: Width: full container. Padding: 20px 24px. Left border: 4px solid `var(--accent)`. Height: auto.

**Spacing**: Mode name margin-bottom: 8px. Explanation margin-bottom: 16px (if action button present).

**Responsive Behavior**: No layout change. Text wraps naturally on mobile.

**Theme Sensitivity**: `--surface`, `--border`, `--accent`, `--accent-soft`, `--accent-text`, `--text-primary`, `--text-secondary`, `--text-muted`

**Animation**: Entry: `slideUp 500ms ease-smooth forwards` — slightly more dramatic than standard fadeUp to signal importance.

**Accessibility**: `role="region"`, `aria-label="AI recommendation"`. If there's a recommended mode, announce it: `aria-live="polite"` on first render. Action button: `aria-label="[action label] for [mode name]"`.

---

#### PlanSimulator

**Purpose**: Shows the trade-off deltas between choices — e.g., "₹460 saved by cooking, +59g protein vs delivery."

**Visual Description**: Compact horizontal strip or small card with two to four delta metrics. Each metric: a value badge (large, accent-colored number with unit) + a short label. Positive deltas: accent color. Negative deltas (e.g., extra time cost): muted color. A small icon precedes each metric.

**States**:
- Default: static metrics display
- Hover: subtle card elevation (`--shadow-card`)
- Loading: shimmer skeleton across the value badges

**Props (conceptual)**: deltas (array of `{icon, value, unit, label, positive: boolean}`), comparison baseline label

**Dimensions**: Width: full container. Height: auto, min 64px. Padding: 14px 16px. Metric gap: 20px.

**Spacing**: Icon gap to value: 6px. Value to label: 4px. Metric separator: vertical `--border` line, 1px.

**Responsive Behavior**: On mobile, wrap metrics to two rows of two.

**Theme Sensitivity**: `--surface`, `--border`, `--accent`, `--accent-text`, `--text-muted`, `--text-primary`

**Animation**: Entry: `fadeUp 400ms ease-smooth forwards`. Delta values count up from 0 on mount (600ms, linear easing in JS).

**Accessibility**: `role="region"`, `aria-label="Plan comparison"`. Each delta: include full readable text in `aria-label` — e.g., `aria-label="Save ₹460 by cooking instead of ordering"`.

---

#### CookingStepCard

**Purpose**: Displays one cooking step in the active cooking flow, with step number, instruction, detail, time, and an inline YouTube clip button.

**Visual Description**: Elevated card with a top section (step number badge + title + time) and a body section (detailed instruction text). At the bottom-right: a compact YouTube button — thumbnail preview (small, 48×27px) + "Watch clip" label + play icon. This is distinct from StepItem (which is a list row) — CookingStepCard is the expanded, focused view of one step.

**States**:
- Current (active): `border: 2px solid var(--accent)`, `box-shadow: var(--shadow-elevated)`, step number fills accent
- Completed: title strikethrough, accent number fill, `opacity: 0.7`
- YouTube button hover: `background: var(--bg3)`, thumbnail brightens slightly
- YouTube button — no clip available: button is hidden entirely

**Props (conceptual)**: step number, title, detail text, time estimate, done state, youtube clip URL (optional), youtube thumbnail URL (optional), on-toggle-done, on-open-youtube

**Dimensions**: Width: full container. Padding: 20px. Min height: 100px. YouTube button: 44px height minimum.

**Spacing**: Step number badge size: 32×32px. Gap between badge and title: 12px. Body padding-top: 12px. YouTube button margin-top: 16px.

**Responsive Behavior**: No layout change — single column. YouTube button full-width on mobile or right-aligned on desktop.

**Theme Sensitivity**: `--surface`, `--border`, `--accent`, `--bg3`, `--text-primary`, `--text-muted`

**Animation**: Step completion: number fill at 300ms `ease-smooth`, title strikethrough appears instantly. Card entry as part of staggered list: `fadeUp 400ms ease-smooth forwards`.

**Accessibility**: Wraps step content in `role="article"`. Done toggle: `role="button"`, `aria-pressed`. YouTube button: `aria-label="Watch [step title] clip on YouTube"`, `target="_blank"` with `rel="noopener noreferrer"`.

---

#### MemoryPanel

**Purpose**: Shows the AI's stored facts about the user (dietary preferences, saved addresses, past choices) with per-fact edit and delete controls.

**Visual Description**: Surface panel with a heading ("What I know about you"), section labels grouping facts (e.g., "Dietary", "Location"), and a list of fact pills. Each fact: small text label + edit icon button + delete icon button. Delete shows a micro-confirm inline before acting. An empty state shows a friendly message and an "Add a preference" button.

**States**:
- Default: list of fact pills
- Empty: empty state illustration area + CTA
- Deleting: row highlight in accent-soft + inline "Confirm delete?" mini buttons (150ms transition)
- Editing: inline text input replaces the fact label, save/cancel buttons appear

**Props (conceptual)**: facts (array of `{id, category, label}`), on-edit handler, on-delete handler, on-add handler

**Dimensions**: Width: full container. Max-width: 560px. Padding: 20px. Fact pill height: 40px min. Edit input: same height as fact pill.

**Spacing**: Section label margin-bottom: 12px. Fact gap: 8px. Icon button spacing within fact: 8px.

**Responsive Behavior**: Full-width on mobile. Edit input takes full row width.

**Theme Sensitivity**: `--surface`, `--border`, `--accent`, `--accent-soft`, `--accent-text`, `--chip-bg`, `--text-primary`, `--text-muted`

**Animation**: Fact entry: `fadeIn 200ms ease-smooth`. Deletion confirm: fact row transitions background to `--accent-soft` at 150ms. Deleted fact: `opacity 0, translateX(20px)` exit animation at 200ms before DOM removal.

**Accessibility**: Panel: `role="region"`, `aria-label="Saved preferences"`. Fact list: `role="list"`. Each fact: `role="listitem"`. Delete: `aria-label="Delete preference: [fact label]"`. Confirm delete: `role="alertdialog"` pattern inline. Edit: input has `aria-label="Edit preference"`, announce save/cancel with `aria-live`.

---

#### VoiceButton

**Purpose**: Microphone button for voice input — triggers speech recognition and feeds the result into the search flow.

**Visual Description**: Circular button, 48px diameter. Icon: microphone SVG. Fill: `var(--accent)`. Icon: white. A ring element (absolutely positioned, larger radius) animates during listening state.

**States and Animations**: See Section 2.4 (Voice Button Animation) for full per-state description.

**Props (conceptual)**: listening state (idle/listening/processing/error), on-click handler, disabled flag

**Dimensions**: Button: 48×48px. Ring: starts at 48×48px, expands to ~86×86px. Ring is `pointer-events: none`.

**Spacing**: Positioned inline beside the search input's submit area, or as a floating button. If floating: `position: fixed`, bottom: 100px + sticky CTA height, right: 20px.

**Responsive Behavior**: No size change. Floating placement may shift on different viewport sizes.

**Theme Sensitivity**: `--accent`

**Animation**: Per Section 2.4. Ring: `voiceRing 1.2s ease-smooth infinite`. Two rings, staggered by 0.6s.

**Accessibility**: `role="button"`, `aria-label` changes by state: "Start voice input" (idle), "Listening — tap to stop" (listening), "Processing voice input" (processing), "Voice input failed — tap to retry" (error). `aria-pressed="true"` during listening. Announce state changes with `aria-live="assertive"`.

---

#### YouTubeCard

**Purpose**: Embeds a YouTube video reference — thumbnail, channel name, duration, and a timestamp deep-link.

**Visual Description**: Surface card. Top: 16:9 thumbnail image (`next/image`, fixed width). Bottom: video title (bold, 2-line max), channel name (muted, smaller), duration badge (top-right of thumbnail, dark semi-transparent pill), and a "Watch from [timestamp]" link in accent color.

**States**:
- Default: static card
- Hover: `transform: translateY(-2px)`, `box-shadow: var(--shadow-elevated)`, thumbnail brightens (CSS `brightness(1.05)`)
- Loading: skeleton — thumbnail area skeleton + two text row skeletons

**Props (conceptual)**: video title, channel name, thumbnail URL, video URL, timestamp (seconds), duration, on-click handler

**Dimensions**: Width: full container (max ~360px when inline, full-width when in a dedicated section). Thumbnail height: 16:9 ratio (auto). Card padding: 12px.

**Spacing**: Title margin-top: 10px. Channel margin-top: 4px. Link margin-top: 8px.

**Responsive Behavior**: Full-width on mobile. In a two-column grid on wide screens.

**Theme Sensitivity**: `--surface`, `--border`, `--text-primary`, `--text-muted`, `--accent`

**Animation**: Hover: `translateY(-2px)` + shadow at 250ms `ease-smooth`.

**Accessibility**: Entire card is a link (`role="link"` or anchor element). `aria-label="Watch [video title] by [channel] — [duration], starting at [timestamp]"`. Thumbnail image: `alt="Thumbnail for [video title]"`. Opens in new tab: `rel="noopener noreferrer"`.

---

#### InstamartCart

**Purpose**: Shows the assembled grocery cart for the selected recipe — ingredient list with names, quantities, prices, delivery ETA, and an "Add to Instamart" action.

**Visual Description**: Surface panel. Header: "Your Instamart Cart" + cart icon + total item count badge. Body: scrollable list of ingredient rows — each row has an ingredient name, quantity, and estimated price on the right. Footer: total price (bold), ETA label (e.g., "Arrives in 10–15 min"), and the primary "Add to Instamart" button.

**States**:
- Default: full ingredient list
- Empty: "No ingredients yet" empty state + "Select a recipe" link
- Adding (after CTA press): spinner on button, button text changes to "Adding…", rows get a subtle check animation as they're added
- Success: button turns green for 1.5s ("Added! Open Swiggy Instamart"), then returns to default or disabled
- Partial (some ingredients unavailable): unavailable rows are dimmed with a "Not available" label, total reflects available only

**Props (conceptual)**: ingredients (array of `{name, quantity, unit, price, available: boolean}`), total price, eta string, on-add handler

**Dimensions**: Width: full container. Max-height: 400px (scroll internally if more than ~6 items). Row height: 44px min. Footer height: 80px. Padding: 16px.

**Spacing**: Row padding: 12px 0. Row internal gap: 8px. Footer margin-top: auto (sticky to bottom of panel).

**Responsive Behavior**: Full-width. Internal scroll handles tall lists on mobile.

**Theme Sensitivity**: `--surface`, `--border`, `--accent`, `--text-primary`, `--text-muted`, `--chip-bg`

**Animation**: Cart entry: `fadeUp 400ms ease-smooth forwards`. Row items stagger in at 50ms per item (max 6 staggered). Button success flash: `background: #22c55e` at 150ms `ease-smooth`, hold 1.5s, revert.

**Accessibility**: `role="region"`, `aria-label="Instamart cart"`. List: `role="list"`. Each ingredient: `role="listitem"`. Unavailable items: `aria-disabled="true"`, `aria-label="[name] — not available"`. CTA button: `aria-live="polite"` region around the button to announce state changes ("Adding…", "Added!").

---

## 4. Layout System

### Max Content Widths

| Context | Max Width |
|---|---|
| Landing search area (search bar + chips) | 560px |
| Flow screens (standard) | 800px |
| Flow screens (wide, ≥1024px) | 1120px |
| Mode cards | 720px |
| Intent screen content | 720px |

All flow screens: `margin: 0 auto` to center within the viewport.

### Structural Constants

| Element | Value | Notes |
|---|---|---|
| Navbar height | 56px | Fixed, `position: fixed`, `z-index: 100` |
| Content `padding-top` | 56px | Equals navbar height — prevents content from hiding under it |
| Bottom safe area | 100px | `padding-bottom` on flow screens — accounts for sticky CTA (approx. 72px) + mode tab overlap |
| Mode tab `bottom` | 90px | Positioned above sticky CTA |
| Sticky CTA `bottom` | 0 | Anchored to viewport bottom |

### Scroll Container

Scrolling happens on `.app-scroll` (not `html` or `body`):
- `height: 100vh`, `overflow-y: auto`, `overscroll-behavior-y: contain`
- `scroll-padding-top: 56px` — ensures anchor links account for the fixed navbar
- `.app-shell` is `overflow: hidden` — it never scrolls, only `.app-scroll` does

### Grid System

**Standard Cards Grid**:
```css
display: grid;
grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
gap: 16px;
```

**Wide Screen Cards Grid** (≥1024px):
```css
grid-template-columns: repeat(3, minmax(280px, 1fr));
gap: 20px;
```

**Mode Cards Grid**:
```css
grid-template-columns: repeat(3, 1fr);
gap: 16px;
/* mobile: */
grid-template-columns: 1fr;
```

**Dineout Cards**: Full-width single-column list layout only. No grid — each `.dine-card` is `margin-bottom: 16px` with full container width.

### Breakpoints

| Name | Value | Trigger |
|---|---|---|
| Mobile | <600px | Single-column layouts, simplified typography, stacked mode cards |
| Tablet | 600px–767px | Mode cards expand gap to 20px, chips row widens to 600px |
| Laptop | 768px–1023px | General desktop layout |
| Wide | ≥1024px | Flow screens expand to 1120px, 3-column card grids, wider time slot columns |

Apply breakpoints via `@media (min-width: Npx)` — always mobile-first.

---

## 5. Iconography and Media

### V1 Icon Approach

Version 1 uses **text abbreviations as visual icons** — typically 2-letter uppercase codes inside styled containers (e.g., `YT` for YouTube, `IM` for Instamart). This is intentional for prototype velocity. These should be `font-family: monospace`, `font-size: 11–13px`, `font-weight: 700`, `color: var(--text-muted)`.

V1 also uses emoji for mode indicators and quick visual cues (e.g., 🍳, 🛒, 🍽️). These are acceptable in prototype phase but will be replaced in V2 with a custom SVG icon set.

**V2 Icon Migration Trigger**: Replace text/emoji icons with SVG icons when:
- Design has a final icon set approved for the product
- The product ships to users outside internal review
- Any icon needs to animate (e.g., the microphone for VoiceButton)
- An icon appears in more than 5 distinct places (worth systematizing)

SVG icons in V2 should be inlined or imported as React components. Never use icon font libraries. Use `aria-hidden="true"` on decorative icons; functional icons need an adjacent visually-hidden label.

### Images

**Required**: Use `next/image` for all content images. Never use `<img>` tags.

| Context | Aspect Ratio | Fixed Height | Notes |
|---|---|---|---|
| FoodCard image | 16:9 effective | 140px | Width: 100% of card |
| DineCard image | 16:9 effective | 200px | Width: 100% of card |
| YouTubeCard thumbnail | 16:9 | Auto (ratio) | Fixed width per layout context |
| Recipe card | 16:9 effective | 140px | Same as FoodCard |

All images: `object-fit: cover`, `object-position: center`.

### Image Fallback Pattern

When an image URL is unavailable or loading, use the `card-img-stripe` pattern:

```css
/* Background container */
.card-img {
  background: var(--bg3);
}

/* Subtle hatched overlay */
.card-img-stripe {
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent 8px,
    rgba(0,0,0,0.03) 8px,
    rgba(0,0,0,0.03) 9px
  );
}
```

Place a text label (dish name or restaurant name) centered over this striped background, using `--text-muted` color, `font-size: 13px`, `font-family: monospace`. For Dineout cards, use Playfair Display italic for the placeholder text inside `.theme-dineout`.

---

## 6. Dark Mode / Latenight Mode

### Activation Conditions

`.theme-latenight` activates when either:
1. The AI classifies the user's situation as `type: "latenight"` (e.g., "late night cravings", "post-party snack", "2 AM hunger")
2. The local time is past 23:00 (11 PM) — the app may auto-suggest latenight mode

The user can also manually select latenight from the mode switcher.

### Latenight Palette Properties

Latenight is not simply a dark mode — it is a distinct theme with a purple-tinted dark palette that evokes late-night ambiance rather than a generic "dark UI."

- Base backgrounds range from near-black `#0f0e1a` (--bg) to dark slate `#1e1c38` (--bg3)
- Surfaces are deep purple-navy (`--surface: #1a1830`)
- Text is lavender-tinted (`--text-primary: #e8e4f8`)
- Accent is purple (`--accent: #7c6fcd`) — distinct from all other modes
- Ambient orbs are purple tinted — subtler than daytime themes (0.08 and 0.04 opacity)

### Special Typographic Rules

```css
/* Applied only in latenight mode */
.theme-latenight .landing-headline {
  font-style: italic;
}
```

The italic headline is the only theme-specific typographic override in V1. It signals the late-night register — atmospheric, softer. Do not apply italic to other headlines in latenight mode.

### Latenight Contrast Validation

Key pairings to verify against WCAG AA:

| Pairing | Foreground | Background | Required Ratio |
|---|---|---|---|
| Primary text on bg | `#e8e4f8` | `#0f0e1a` | 4.5:1 (AA) |
| Secondary text on bg | `#9890c8` | `#0f0e1a` | 4.5:1 |
| Muted text on bg | `#5a5480` | `#0f0e1a` | 3:1 (AA Large) |
| White chip text on chip-active | `#ffffff` | `#7c6fcd` | 4.5:1 |
| Accent-text on surface | `#a899e8` | `#1a1830` | 4.5:1 |

The `--text-muted` / `--bg` pairing in latenight (`#5a5480` on `#0f0e1a`) may be close to the 3:1 threshold — validate with a contrast checker before production. Never use `--text-muted` for interactive elements in latenight mode; use `--text-secondary` at minimum.

### Images in Latenight Mode

No CSS filter is applied to images in latenight mode — content images are not darkened. The dark chrome around them provides sufficient separation.

---

## 7. Implementation Guide

### CSS Architecture

MealOS uses **CSS Modules for component-scoped styles** combined with **global CSS custom properties** defined in `mealos.css` (or a production equivalent, `globals.css`).

Pattern per component:

```jsx
// FoodCard.tsx
import styles from './FoodCard.module.css'

export function FoodCard({ name, price }) {
  return (
    <article className={styles.card}>
      <div className={styles.image} />
      <div className={styles.body}>
        <p className={styles.name}>{name}</p>
        <span className={styles.price}>{price}</span>
      </div>
    </article>
  )
}
```

```css
/* FoodCard.module.css */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  transition: transform 300ms var(--ease-smooth), box-shadow 300ms var(--ease-smooth);
}

.card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-elevated);
  border-color: var(--accent);
}

.name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.price {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}
```

### The No-Hardcode Rule

**Never write a hex color value inside a component file.** The only permitted location for hex values is the theme token definitions in `globals.css`. Component files must only reference `var(--token-name)`.

Correct:
```css
.button { background: var(--accent); color: #fff; }
```

(`#fff` for white on a colored surface is an acceptable single exception — it is not theme-variable. All other values must use tokens.)

Wrong:
```css
.button { background: #c68e69; } /* never — hardcoded hex */
```

### Font Loading (next/font)

```tsx
// app/layout.tsx
import { DM_Sans, Playfair_Display } from 'next/font/google'

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-ui',
  display: 'swap',
})

const playfairDisplay = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
  style: ['normal', 'italic'],
  display: 'swap',
})

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${playfairDisplay.variable}`}>
      <body>{children}</body>
    </html>
  )
}
```

CSS then accesses these via the variables defined in `:root` of `globals.css`:
```css
:root {
  --font-ui: var(--font-ui-next);    /* next/font injects --font-ui-next */
  --font-display: var(--font-display-next);
}
```

Or, more directly, `next/font` variables are usable immediately after being added to `<html className>` — reference `var(--font-ui)` and `var(--font-display)` throughout CSS modules without any additional setup.

### Theme Application

The theme class lives on `.app-shell`. In React, this maps to the outermost layout wrapper:

```tsx
<div className={`app-shell theme-${currentTheme}`}>
  {/* app content */}
</div>
```

Where `currentTheme` is one of: `neutral`, `instamart`, `delivery`, `dineout`, `latenight`.

All CSS custom property values cascade from this class. Components never need to be aware of the active theme — they only reference `var(--token-name)`.

### Responsive Patterns

Use a mobile-first approach. Base styles target mobile; `@media (min-width: Npx)` progressively enhances for larger screens:

```css
/* Base (mobile) */
.modeCards {
  grid-template-columns: 1fr;
  max-width: 360px;
}

/* Tablet+ */
@media (min-width: 600px) {
  .modeCards {
    grid-template-columns: repeat(3, 1fr);
    max-width: 720px;
    gap: 20px;
  }
}
```

### Component Composition Checklist

Before marking any component as production-ready, verify:

- [ ] All color values use `var(--token)`, no hardcoded hex (exception: `#fff` for white only)
- [ ] Interactive elements meet 44×44px touch target on mobile
- [ ] Entry animation uses `forwards` fill mode
- [ ] Hover/active transitions use `--ease-smooth` or `--ease-spring` appropriately
- [ ] `aria-label`, `role`, and keyboard interaction are implemented
- [ ] Loading/skeleton state exists for any component that fetches data
- [ ] Component is tested across all 5 theme classes
- [ ] Text sizing uses the scale — no arbitrary pixel values outside the defined scale
- [ ] `next/image` used for all image elements
