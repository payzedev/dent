'use client'

import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { useTranslations } from 'next-intl'
import { XIcon } from '@/components/icons'

type BarcodeScannerProps = {
  onDetected: (barcode: string) => void
  onClose: () => void
}

export function BarcodeScanner({ onDetected, onClose }: BarcodeScannerProps) {
  const t = useTranslations()
  const videoRef = useRef<HTMLVideoElement>(null)
  const onDetectedRef = useRef(onDetected)
  const [error, setError] = useState('')

  useEffect(() => { onDetectedRef.current = onDetected }, [onDetected])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    let active = true
    let controls: IScannerControls | undefined
    const reader = new BrowserMultiFormatReader()

    void reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video, (result, _decodeError, scanningControls) => {
      controls = scanningControls
      if (!active || !result) return
      active = false
      scanningControls.stop()
      onDetectedRef.current(result.getText())
    }).then((scannerControls) => {
      controls = scannerControls
      if (!active) scannerControls.stop()
    }).catch(() => {
      if (active) setError(t('cameraUnavailable'))
    })

    return () => {
      active = false
      controls?.stop()
      const stream = video.srcObject
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop())
    }
  }, [t])

  return <div className="dialog-backdrop scanner-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="barcode-scanner-title" className="scanner-dialog card">
      <button type="button" className="icon-button dialog-close" aria-label={t('close')} onClick={onClose}><XIcon /></button>
      <h2 id="barcode-scanner-title">{t('scanBarcode')}</h2>
      <p className="subtle">{t('cameraPermissionHint')}</p>
      <video ref={videoRef} className="scanner-video" autoPlay muted playsInline />
      <div className="scanner-frame" aria-hidden="true" />
      {error ? <p role="alert" className="error-message">{error}</p> : <p role="status" className="field-hint">{t('scannerReady')}</p>}
      <button type="button" className="secondary-button" onClick={onClose}>{t('cancel')}</button>
    </section>
  </div>
}
