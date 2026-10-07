// Derived from ItsHover's shadcn registry icons; consolidated for DentaStock.
// Animation wrappers and sizing have been adapted to the existing navigation API.
'use client'

import { forwardRef, useCallback, useImperativeHandle } from 'react'
import { motion, useAnimate } from 'motion/react'
import type { AnimatedIconHandle, AnimatedIconProps } from './types'

export const HomeIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(({ size = 24, color = 'currentColor', strokeWidth = 2, className = '' }, ref) => {
  const [scope, animate] = useAnimate()
  const start = useCallback(async () => {
    animate('.roof', { y: [-2, 0], opacity: [0.6, 1] }, { duration: 0.4, ease: 'easeOut' })
    await animate('.house', { scale: [0.95, 1] }, { duration: 0.3, ease: 'easeOut' })
    animate('.door', { scaleY: [0, 1] }, { duration: 0.3, ease: 'easeOut' })
  }, [animate])
  const stop = useCallback(() => animate('.roof, .house, .door', { y: 0, opacity: 1, scale: 1, scaleY: 1 }, { duration: 0.2, ease: 'easeInOut' }), [animate])
  useImperativeHandle(ref, () => ({ startAnimation: start, stopAnimation: stop }))
  return <motion.svg ref={scope} aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={`cursor-pointer ${className}`} onHoverStart={start} onHoverEnd={stop}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <motion.path className="roof" d="M5 12l-2 0l9 -9l9 9l-2 0" />
    <motion.path className="house" style={{ transformOrigin: 'center' }} d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7" />
    <motion.path className="door" style={{ transformOrigin: 'center bottom' }} d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6" />
  </motion.svg>
})
HomeIcon.displayName = 'HomeIcon'

export const LayersIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(({ size = 24, color = 'currentColor', strokeWidth = 2, className = '' }, ref) => {
  const [scope, animate] = useAnimate()
  const start = useCallback(async () => animate('.top-block', { x: -20 }, { duration: 0.4, ease: [0.4, 0, 0.2, 1] }), [animate])
  const stop = useCallback(async () => animate('.top-block', { x: 0 }, { duration: 0.4, ease: [0.4, 0, 0.2, 1] }), [animate])
  useImperativeHandle(ref, () => ({ startAnimation: start, stopAnimation: stop }))
  return <motion.svg ref={scope} aria-hidden="true" onHoverStart={start} onHoverEnd={stop} width={size} height={size} viewBox="0 0 120 120" fill="none" strokeWidth={strokeWidth} xmlns="http://www.w3.org/2000/svg" className={`cursor-pointer ${className}`} style={{ overflow: 'visible' }}>
    <motion.rect className="top-block" x="44" y="22" width="56" height="36" rx="10" fill={color} />
    <rect x="20" y="62" width="64" height="40" rx="12" fill={color} />
  </motion.svg>
})
LayersIcon.displayName = 'LayersIcon'

export const ScanIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(({ size = 24, color = 'currentColor', strokeWidth = 2, className = '' }, ref) => {
  const [scope, animate] = useAnimate()
  const start = useCallback(async () => {
    await animate('.scan-line', { y: [0, 10, -10, 0], opacity: [0.3, 1, 0.3, 1] }, { duration: 1.2, ease: 'easeInOut' })
    animate('.corners', { scale: [1, 1.05, 1] }, { duration: 0.4, ease: 'easeOut' })
  }, [animate])
  const stop = useCallback(() => animate('.scan-line, .corners', { y: 0, opacity: 1, scale: 1 }, { duration: 0.2, ease: 'easeInOut' }), [animate])
  useImperativeHandle(ref, () => ({ startAnimation: start, stopAnimation: stop }))
  return <motion.svg ref={scope} aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={`cursor-pointer ${className}`} onHoverStart={start} onHoverEnd={stop}>
    <motion.g className="corners"><path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /></motion.g>
    <motion.g className="barcode"><path d="M8 7v10" /><path d="M12 7v10" /><path d="M17 7v10" /></motion.g>
    <motion.line className="scan-line" x1="8" x2="17" y1="12" y2="12" strokeWidth={strokeWidth} initial={{ opacity: 0.3 }} />
  </motion.svg>
})
ScanIcon.displayName = 'ScanBarcodeIcon'

export const UserIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(({ size = 24, color = 'currentColor', strokeWidth = 2, className = '' }, ref) => {
  const [scope, animate] = useAnimate()
  const start = useCallback(() => animate('.user-avatar', { scale: 1.05, y: -1 }, { duration: 0.25, ease: 'easeOut' }), [animate])
  const stop = useCallback(() => animate('.user-avatar', { scale: 1, y: 0 }, { duration: 0.2, ease: 'easeInOut' }), [animate])
  useImperativeHandle(ref, () => ({ startAnimation: start, stopAnimation: stop }))
  return <motion.svg ref={scope} aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={`cursor-pointer ${className}`} onHoverStart={start} onHoverEnd={stop}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <motion.g className="user-avatar" style={{ transformOrigin: '50% 50%' }}><path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" /><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" /></motion.g>
  </motion.svg>
})
UserIcon.displayName = 'UserIcon'

export const MessageIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(({ size = 24, color = 'currentColor', strokeWidth = 2, className = '' }, ref) => {
  const [scope, animate] = useAnimate()
  const start = useCallback(async () => {
    animate('.message-path', { pathLength: 0, opacity: 0 }, { duration: 0 })
    await animate('.message-path', { pathLength: [0, 1], opacity: [0, 1] }, { duration: 0.6, ease: 'easeInOut' })
    animate('.message-path', { scale: [1, 1.05, 1] }, { duration: 0.3, ease: 'easeOut' })
  }, [animate])
  const stop = useCallback(() => animate('.message-path', { pathLength: 1, opacity: 1, scale: 1 }, { duration: 0.2 }), [animate])
  useImperativeHandle(ref, () => ({ startAnimation: start, stopAnimation: stop }))
  return <motion.svg ref={scope} aria-hidden="true" onHoverStart={start} onHoverEnd={stop} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={`cursor-pointer ${className}`} style={{ overflow: 'visible' }}>
    <motion.path className="message-path" d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" initial={{ pathLength: 1, opacity: 1 }} style={{ transformOrigin: 'center' }} />
  </motion.svg>
})
MessageIcon.displayName = 'MessageCircleIcon'

export const ShieldCheckIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(({ size = 24, color = 'currentColor', strokeWidth = 2, className = '' }, ref) => {
  const [scope, animate] = useAnimate()
  const start = useCallback(async () => {
    animate('.shield-body', { scale: [1, 1.05, 1] }, { duration: 0.35, ease: 'easeOut' })
    await animate('.shield-check', { pathLength: [0, 1], opacity: [0, 1] }, { duration: 0.3, ease: 'easeInOut' })
  }, [animate])
  const stop = useCallback(() => {
    animate('.shield-body', { scale: 1 }, { duration: 0.2 })
    animate('.shield-check', { pathLength: 1, opacity: 1 }, { duration: 0.2 })
  }, [animate])
  useImperativeHandle(ref, () => ({ startAnimation: start, stopAnimation: stop }))
  return <motion.svg ref={scope} aria-hidden="true" onHoverStart={start} onHoverEnd={stop} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={`cursor-pointer ${className}`} style={{ overflow: 'visible' }}>
    <motion.path className="shield-body" style={{ transformOrigin: '50% 50%' }} d="M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06" />
    <motion.path className="shield-check" d="M15 19l2 2l4 -4" initial={{ pathLength: 1, opacity: 1 }} />
  </motion.svg>
})
ShieldCheckIcon.displayName = 'ShieldCheckIcon'

export const SearchIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(({ size = 24, color = 'currentColor', strokeWidth = 2, className = '' }, ref) => {
  const [scope, animate] = useAnimate()
  const start = useCallback(async () => animate('.magnifier-group', { x: [0, 1, 0, -1, 0], y: [0, -1, -2, -1, 0], rotate: [0, -5, 5, -5, 0] }, { duration: 1, ease: 'easeInOut' }), [animate])
  const stop = useCallback(() => animate('.magnifier-group', { x: 0, y: 0, rotate: 0 }, { duration: 0.2, ease: 'easeOut' }), [animate])
  useImperativeHandle(ref, () => ({ startAnimation: start, stopAnimation: stop }))
  return <motion.svg ref={scope} onHoverStart={start} onHoverEnd={stop} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 32 32" fill="none" stroke={color} strokeWidth={strokeWidth * (32 / 24)} strokeMiterlimit="10" className={`cursor-pointer ${className}`} style={{ overflow: 'visible' }}>
    <motion.g className="magnifier-group" style={{ transformOrigin: '13px 13px', transformBox: 'fill-box' }}><motion.path d="m21.393,18.565l7.021,7.021c.781.781.781,2.047,0,2.828h0c-.781.781-2.047.781-2.828,0l-7.021-7.021" /><motion.circle cx="13" cy="13" r="10" strokeLinecap="square" /></motion.g>
  </motion.svg>
})
SearchIcon.displayName = 'MagnifierIcon'

export const AlertIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(({ size = 24, color = 'currentColor', strokeWidth = 2, className = '' }, ref) => {
  const [scope, animate] = useAnimate()
  const start = useCallback(async () => {
    await animate('.triangle', { y: [0, -1.5, 0] }, { duration: 0.25, ease: 'easeOut' })
    animate('.exclamation-line', { scaleY: [1, 1.35, 1] }, { duration: 0.3, ease: 'easeOut' })
    animate('.exclamation-dot', { scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }, { duration: 0.25, delay: 0.05, ease: 'easeOut' })
  }, [animate])
  const stop = useCallback(() => {
    animate('.triangle', { y: 0 }, { duration: 0.2, ease: 'easeOut' })
    animate('.exclamation-line', { scaleY: 1 }, { duration: 0.2, ease: 'easeOut' })
    animate('.exclamation-dot', { scale: 1, opacity: 1 }, { duration: 0.2, ease: 'easeOut' })
  }, [animate])
  useImperativeHandle(ref, () => ({ startAnimation: start, stopAnimation: stop }))
  return <motion.svg ref={scope} aria-hidden="true" onHoverStart={start} onHoverEnd={stop} xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={`cursor-pointer ${className}`}>
    <motion.path className="triangle" d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <g><motion.path className="exclamation-line" d="M12 9v4" style={{ transformOrigin: '12px 11px' }} /><motion.path className="exclamation-dot" d="M12 17h.01" style={{ transformOrigin: '12px 17px' }} /></g>
  </motion.svg>
})
AlertIcon.displayName = 'TriangleAlertIcon'

export const XIcon = forwardRef<AnimatedIconHandle, AnimatedIconProps>(({ size = 24, color = 'currentColor', strokeWidth = 2, className = '' }, ref) => {
  const [scope, animate] = useAnimate()
  const start = useCallback(() => {
    animate('.x-line-1', { rotate: 15, scale: 1.1 }, { duration: 0.2, ease: 'easeOut' })
    animate('.x-line-2', { rotate: -15, scale: 1.1 }, { duration: 0.2, ease: 'easeOut' })
  }, [animate])
  const stop = useCallback(() => {
    animate('.x-line-1', { rotate: 0, scale: 1 }, { duration: 0.2, ease: 'easeInOut' })
    animate('.x-line-2', { rotate: 0, scale: 1 }, { duration: 0.2, ease: 'easeInOut' })
  }, [animate])
  useImperativeHandle(ref, () => ({ startAnimation: start, stopAnimation: stop }))
  return <motion.svg ref={scope} aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={`cursor-pointer ${className}`} onHoverStart={start} onHoverEnd={stop}>
    <path stroke="none" d="M0 0h24v24H0z" fill="none" />
    <motion.path d="M18 6l-12 12" className="x-line-1" style={{ transformOrigin: '50% 50%' }} />
    <motion.path d="M6 6l12 12" className="x-line-2" style={{ transformOrigin: '50% 50%' }} />
  </motion.svg>
})
XIcon.displayName = 'XIcon'
