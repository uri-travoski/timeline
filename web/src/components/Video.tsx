import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type Hls from 'hls.js';

// hls.js is ~500 KB: load it only once a video actually needs it.
let hlsModule: Promise<typeof import('hls.js')> | null = null;
export const loadHls = () => (hlsModule ??= import('hls.js'));
import type { Attachment } from '../lib/api';

export type Preload = 'none' | 'warm' | 'full';

export interface VideoHandle {
  el: HTMLVideoElement | null;
}

/**
 * HLS-aware <video>. `preload` controls how much is fetched before playing:
 *  - none: poster only
 *  - warm: first few seconds buffered (next reels), so playback starts instantly
 *  - full: normal buffering (the video on screen)
 * Falls back to the original file while the HLS renditions are still being made.
 */
export const Video = forwardRef<VideoHandle, {
  att: Attachment;
  preload: Preload;
  className?: string;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  playsInline?: boolean;
  onClick?: () => void;
  onTime?: (fraction: number) => void;
}>(function Video({ att, preload, className, muted, loop, controls, onClick, onTime }, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const preloadRef = useRef(preload);
  preloadRef.current = preload;
  useImperativeHandle(ref, () => ({ el: videoRef.current }), []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || preload === 'none') return;
    const src = att.hlsUrl;
    let cancelled = false;
    let hls: Hls | null = null;
    // Safari/iOS play HLS natively.
    if (src && v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = src;
    } else if (src) {
      loadHls().then(({ default: HlsCls }) => {
        if (cancelled) return;
        if (!HlsCls.isSupported()) {
          v.src = att.url;
          return;
        }
        hls = new HlsCls({
          startLevel: -1,                 // pick from bandwidth estimate
          capLevelToPlayerSize: true,     // never fetch more pixels than the screen shows
          maxBufferLength: preloadRef.current === 'warm' ? 4 : 30,
          maxMaxBufferLength: 60,
          backBufferLength: 10,
          startFragPrefetch: true,
          abrEwmaDefaultEstimate: 2_500_000,
        });
        hls.loadSource(src);
        hls.attachMedia(v);
        hlsRef.current = hls;
      });
    } else {
      // Renditions not ready yet: play the original file (served with Range support).
      v.src = att.url;
    }
    v.preload = 'auto';
    return () => {
      cancelled = true;
      hls?.destroy();
      hlsRef.current = null;
      v.removeAttribute('src');
      v.load();
    };
  }, [att.hlsUrl, att.url, preload === 'none']); // eslint-disable-line react-hooks/exhaustive-deps

  // Promote a warmed-up player to full buffering without reloading.
  useEffect(() => {
    if (hlsRef.current) hlsRef.current.config.maxBufferLength = preload === 'warm' ? 4 : 30;
  }, [preload]);

  return (
    <video
      ref={videoRef}
      className={className}
      poster={att.posterUrl ?? undefined}
      muted={muted}
      loop={loop}
      controls={controls}
      playsInline
      preload={preload === 'none' ? 'none' : 'auto'}
      onClick={onClick}
      onTimeUpdate={onTime ? (e) => onTime(e.currentTarget.currentTime / (e.currentTarget.duration || 1)) : undefined}
    />
  );
});
