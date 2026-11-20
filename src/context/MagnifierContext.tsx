import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { MediaModuleId } from '../types/forensics';
import { useInvestigation } from './InvestigationContext';

interface MagnifierContextValue {
  hoveredModule: MediaModuleId | null;
  registerHeroElement: (el: HTMLElement | null) => void;
  registerModuleAnchor: (id: MediaModuleId, el: HTMLElement | null) => void;
  lensDiameter: number;
}

const LENS_DIAMETER = 104;
const LENS_RADIUS = LENS_DIAMETER / 2;

const MagnifierContext = createContext<MagnifierContextValue | null>(null);

export function MagnifierProvider({ children }: { children: ReactNode }) {
  const { isWorkbenchOpen } = useInvestigation();
  const [hoveredModule, setHoveredModule] = useState<MediaModuleId | null>(null);

  const heroElRef = useRef<HTMLElement | null>(null);
  const moduleAnchorsRef = useRef<Map<MediaModuleId, HTMLElement>>(new Map());
  const lensElRef = useRef<HTMLDivElement | null>(null);
  const isWorkbenchOpenRef = useRef(isWorkbenchOpen);
  isWorkbenchOpenRef.current = isWorkbenchOpen;

  const pointerViewport = useRef({ x: -300, y: -300, active: false });
  const targetViewport = useRef({ x: -300, y: -300 });
  const currentViewport = useRef({ x: -300, y: -300 });
  const targetRadius = useRef(0);
  const currentRadius = useRef(0);
  const targetScale = useRef(1);
  const currentScale = useRef(1);
  const rafId = useRef<number | null>(null);
  const hoveredModuleRef = useRef<MediaModuleId | null>(null);

  // Auto-scroll lock onto first card ('audio') when scrolling down from hero
  const scrollAutoLockRef = useRef(false);
  const lastUserMoveAt = useRef(0);

  const registerHeroElement = useCallback((el: HTMLElement | null) => {
    heroElRef.current = el;
  }, []);

  const registerModuleAnchor = useCallback((id: MediaModuleId, el: HTMLElement | null) => {
    if (el) {
      moduleAnchorsRef.current.set(id, el);
    } else {
      moduleAnchorsRef.current.delete(id);
    }
  }, []);

  useEffect(() => {
    const isCoarse = window.matchMedia('(pointer: coarse)').matches;
    if (isCoarse) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const posEase = reducedMotion ? 1 : 0.16;
    const radEase = reducedMotion ? 1 : 0.16;

    const evaluateTarget = () => {
      const px = pointerViewport.current.x;
      const py = pointerViewport.current.y;

      // Check proximity to registered 4 media module cards (only when popup window is closed)
      let nearestId: MediaModuleId | null = null;
      let nearestDist = Infinity;
      let nearestAnchor = { x: px, y: py };

      if (!isWorkbenchOpenRef.current && pointerViewport.current.active) {
        moduleAnchorsRef.current.forEach((el, id) => {
          const rect = el.getBoundingClientRect();
          if (rect.bottom < -40 || rect.top > window.innerHeight + 40) return;

          const dx = Math.max(rect.left - px, 0, px - rect.right);
          const dy = Math.max(rect.top - py, 0, py - rect.bottom);
          const dist = Math.hypot(dx, dy);

          if (dist <= 32 && dist < nearestDist) {
            nearestDist = dist;
            nearestId = id;
            const anchorX = rect.left + rect.width * 0.5;
            const anchorY = rect.top + rect.height * 0.38;
            nearestAnchor = {
              x: anchorX * 0.68 + px * 0.32,
              y: anchorY * 0.68 + py * 0.32,
            };
          }
        });
      }

      // If user scrolled down into workspace and hasn't explicitly moved mouse onto another card,
      // automatically animate the magnifier onto the first card ('audio')!
      if (!isWorkbenchOpenRef.current && !nearestId && scrollAutoLockRef.current) {
        const audioCard = moduleAnchorsRef.current.get('audio');
        if (audioCard) {
          const rect = audioCard.getBoundingClientRect();
          if (rect.bottom > 40 && rect.top < window.innerHeight - 40) {
            nearestId = 'audio';
            nearestAnchor = {
              x: rect.left + rect.width * 0.5,
              y: rect.top + rect.height * 0.42,
            };
            if (!pointerViewport.current.active && currentViewport.current.x < -100) {
              // Seed start position from center-top of viewport so it visibly glides down
              currentViewport.current = {
                x: window.innerWidth * 0.5,
                y: 80,
              };
            }
          }
        }
      }

      if (nearestId !== hoveredModuleRef.current) {
        hoveredModuleRef.current = nearestId;
        setHoveredModule(nearestId);
      }

      if (nearestId) {
        targetViewport.current = nearestAnchor;
        targetRadius.current = LENS_RADIUS;
        targetScale.current = 1.06;
      } else if (pointerViewport.current.active) {
        targetViewport.current = { x: px, y: py };
        targetRadius.current = LENS_RADIUS;

        const elAtPoint = document.elementFromPoint(px, py);
        const insideControl = Boolean(
          elAtPoint?.closest('input, textarea, select, video, canvas, [data-lens-compact="true"]'),
        );
        targetScale.current = insideControl ? 0.56 : 1;
      } else {
        targetRadius.current = 0;
      }
    };

    const tick = () => {
      evaluateTarget();

      currentViewport.current.x += (targetViewport.current.x - currentViewport.current.x) * posEase;
      currentViewport.current.y += (targetViewport.current.y - currentViewport.current.y) * posEase;
      currentRadius.current += (targetRadius.current - currentRadius.current) * radEase;
      currentScale.current += (targetScale.current - currentScale.current) * radEase;

      const lensEl = lensElRef.current;
      if (lensEl) {
        const tx = currentViewport.current.x - LENS_RADIUS;
        const ty = currentViewport.current.y - LENS_RADIUS;
        const visScale = Math.max(
          0.01,
          (currentRadius.current / LENS_RADIUS) * currentScale.current,
        );
        lensEl.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${visScale.toFixed(3)})`;
        lensEl.style.opacity = currentRadius.current > 2 ? '1' : '0';
      }

      const heroEl = heroElRef.current;
      if (heroEl) {
        const heroRect = heroEl.getBoundingClientRect();
        const localX = currentViewport.current.x - heroRect.left;
        const localY = currentViewport.current.y - heroRect.top;
        heroEl.style.setProperty('--lens-x', `${localX.toFixed(2)}px`);
        heroEl.style.setProperty('--lens-y', `${localY.toFixed(2)}px`);
        heroEl.style.setProperty(
          '--lens-r',
          `${(currentRadius.current * currentScale.current).toFixed(2)}px`,
        );
      }

      if (hoveredModuleRef.current) {
        const cardEl = moduleAnchorsRef.current.get(hoveredModuleRef.current);
        if (cardEl) {
          const rect = cardEl.getBoundingClientRect();
          cardEl.style.setProperty(
            '--card-lens-x',
            `${(currentViewport.current.x - rect.left).toFixed(1)}px`,
          );
          cardEl.style.setProperty(
            '--card-lens-y',
            `${(currentViewport.current.y - rect.top).toFixed(1)}px`,
          );
        }
      }

      const settled =
        Math.abs(targetViewport.current.x - currentViewport.current.x) < 0.25 &&
        Math.abs(targetViewport.current.y - currentViewport.current.y) < 0.25 &&
        Math.abs(targetRadius.current - currentRadius.current) < 0.3 &&
        Math.abs(targetScale.current - currentScale.current) < 0.01;

      if (!settled || pointerViewport.current.active || scrollAutoLockRef.current) {
        rafId.current = requestAnimationFrame(tick);
      } else {
        rafId.current = null;
      }
    };

    const startLoop = () => {
      if (rafId.current === null) {
        rafId.current = requestAnimationFrame(tick);
      }
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!pointerViewport.current.active) {
        currentViewport.current = { x: e.clientX, y: e.clientY };
      }
      pointerViewport.current = { x: e.clientX, y: e.clientY, active: true };
      lastUserMoveAt.current = Date.now();
      // Release scroll auto-lock as soon as user actively moves pointer
      scrollAutoLockRef.current = false;
      startLoop();
    };

    const handlePointerLeave = () => {
      pointerViewport.current.active = false;
      startLoop();
    };

    const handleScroll = () => {
      const firstCard = moduleAnchorsRef.current.get('audio');
      const scrollY = window.scrollY;
      const enteredRowZone =
        scrollY > window.innerHeight * 0.28 &&
        firstCard &&
        firstCard.getBoundingClientRect().top < window.innerHeight * 0.85 &&
        firstCard.getBoundingClientRect().bottom > 80;

      if (enteredRowZone) {
        // Engage automatic glide to the first card when scrolling down
        if (Date.now() - lastUserMoveAt.current > 180) {
          scrollAutoLockRef.current = true;
        }
      } else {
        scrollAutoLockRef.current = false;
      }
      startLoop();
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('mouseleave', handlePointerLeave);
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('mouseleave', handlePointerLeave);
      window.removeEventListener('scroll', handleScroll);
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, []);

  return (
    <MagnifierContext.Provider
      value={{
        hoveredModule,
        registerHeroElement,
        registerModuleAnchor,
        lensDiameter: LENS_DIAMETER,
      }}
    >
      {children}

      {/* Global Persistent Precision Optical Magnifier */}
      <div
        ref={lensElRef}
        aria-hidden="true"
        style={{
          width: `${LENS_DIAMETER}px`,
          height: `${LENS_DIAMETER}px`,
          transform: 'translate3d(-300px, -300px, 0) scale(0.01)',
          opacity: 0,
        }}
        className="pointer-events-none fixed left-0 top-0 z-[60] rounded-full will-change-transform"
      >
        <div
          className={`relative h-full w-full rounded-full border-[1.5px] transition-colors duration-200 ${
            hoveredModule
              ? 'border-amber-200/75 bg-indigo-400/[0.08] shadow-[0_0_32px_rgba(129,140,248,0.45),0_10px_24px_rgba(0,0,0,0.52),inset_0_0_18px_rgba(255,255,255,0.2)]'
              : 'border-amber-100/45 bg-indigo-300/[0.04] shadow-[0_0_24px_rgba(148,180,255,0.25),0_8px_20px_rgba(0,0,0,0.45),inset_0_0_16px_rgba(255,255,255,0.14)]'
          } backdrop-brightness-[1.15] backdrop-contrast-[1.08]`}
        >
          {/* Inner precision brass-tinted optical crown ring */}
          <div className="pointer-events-none absolute inset-[3px] rounded-full border border-amber-200/25 shadow-[inset_0_1px_4px_rgba(255,255,255,0.22)]" />
          <div className="pointer-events-none absolute inset-[6px] rounded-full border border-indigo-200/15" />

          {/* Compact sculpted walnut wooden handle + stepped brass ferrule */}
          <svg
            viewBox="0 0 72 72"
            fill="none"
            className="pointer-events-none absolute -bottom-[30px] -right-[30px] h-14 w-14 drop-shadow-[0_6px_12px_rgba(0,0,0,0.65)]"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="brass-ferrule" x1="4" y1="12" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#FEF3C7" />
                <stop offset="40%" stopColor="#D97706" />
                <stop offset="100%" stopColor="#78350F" />
              </linearGradient>
              <linearGradient id="wood-handle" x1="16" y1="16" x2="66" y2="66" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#A96434" />
                <stop offset="38%" stopColor="#763F1C" />
                <stop offset="76%" stopColor="#4B2510" />
                <stop offset="100%" stopColor="#2A1306" />
              </linearGradient>
              <linearGradient id="wood-grain-sheen" x1="20" y1="14" x2="58" y2="52" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#E6AD78" stopOpacity="0.6" />
                <stop offset="55%" stopColor="#B86B35" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#E6AD78" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* Brass connecting collar */}
            <path
              d="M5 12 L12 5 L21 14 L14 21 Z"
              fill="url(#brass-ferrule)"
              stroke="#FEF3C7"
              strokeOpacity="0.5"
              strokeWidth="0.8"
            />
            <path
              d="M12.5 19.5 L19.5 12.5"
              stroke="#FFFBEB"
              strokeOpacity="0.55"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            {/* Contoured turned walnut grip */}
            <path
              d="M15 20 L20 15 Q38 30 62 53 C66 57 66 62 62 65 C59 68 54 68 50 64 Q27 40 15 20 Z"
              fill="url(#wood-handle)"
              stroke="#C88A58"
              strokeOpacity="0.38"
              strokeWidth="0.9"
            />
            {/* Woodgrain highlight & dark grain contour */}
            <path
              d="M21 18 Q39 34 57 53"
              stroke="url(#wood-grain-sheen)"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M19 22 Q35 39 52 57"
              stroke="#241005"
              strokeOpacity="0.45"
              strokeWidth="1"
              strokeLinecap="round"
            />
            {/* Brass pommel ring */}
            <path
              d="M49 57 L57 49"
              stroke="#F59E0B"
              strokeOpacity="0.65"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>

          {/* Optical Glass Specular Crescent & Precision Micro-Reticle */}
          <svg viewBox="0 0 104 104" fill="none" className="absolute inset-0 h-full w-full">
            <defs>
              <linearGradient
                id="global-lens-glint"
                x1="16"
                y1="14"
                x2="58"
                y2="52"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.72" />
                <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M19 42C23 26 35 17 50 15"
              stroke="url(#global-lens-glint)"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <path
              d="M84 66C81 76 73 84 62 87"
              stroke="#A5B4FC"
              strokeOpacity="0.4"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            {/* Cardinal optical calibration ticks */}
            <line x1="52" y1="6" x2="52" y2="11" stroke="#FFFFFF" strokeOpacity="0.52" strokeWidth="1" />
            <line x1="52" y1="93" x2="52" y2="98" stroke="#FFFFFF" strokeOpacity="0.52" strokeWidth="1" />
            <line x1="6" y1="52" x2="11" y2="52" stroke="#FFFFFF" strokeOpacity="0.52" strokeWidth="1" />
            <line x1="93" y1="52" x2="98" y2="52" stroke="#FFFFFF" strokeOpacity="0.52" strokeWidth="1" />
            {/* Precision reticle center dot & faint cross */}
            <circle cx="52" cy="52" r="9" stroke="#C7D2FE" strokeOpacity="0.22" strokeWidth="0.75" strokeDasharray="2 2" />
            <circle cx="52" cy="52" r="1.4" fill="#FFFFFF" fillOpacity="0.72" />
          </svg>
        </div>
      </div>
    </MagnifierContext.Provider>
  );
}

export function useMagnifier() {
  const ctx = useContext(MagnifierContext);
  if (!ctx) {
    throw new Error('useMagnifier must be used inside MagnifierProvider');
  }
  return ctx;
}
