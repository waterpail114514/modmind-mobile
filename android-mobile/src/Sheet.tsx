import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import {motion,useIsPresent} from 'motion/react'
import {useMobileMotion,sheetSpring} from './motion'

export default function Sheet({ title, children, close, className = '', back }: { title: string; children: ReactNode; close(): void; className?: string; back?: () => boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const present=useIsPresent(),{reduce,keyboard}=useMobileMotion(),slide=!reduce&&!keyboard
  const hidden=className.includes('settings-sheet')?'translateX(12%)':'translateY(100%)'
  useLayoutEffect(()=>{if(dialog.current)dialog.current.inert=!present},[present])
  useLayoutEffect(() => { const element=dialog.current;element?.showModal();return()=>element?.close() }, [])
  return <motion.dialog ref={dialog} className={'sheet ' + className} aria-label={title} data-exiting={!present} initial={{opacity:keyboard?1:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:keyboard?0:reduce?.12:.2}} onCancel={event => { event.preventDefault(); if (present&&!back?.()) close() }} onClick={event => { if (present&&event.target === event.currentTarget) close() }}>
    <motion.div className="sheet-surface" initial={{transform:slide?hidden:'none'}} animate={{transform:slide?(className.includes('settings-sheet')?'translateX(0%)':'translateY(0%)'):'none'}} exit={{transform:slide?hidden:'none'}} transition={slide?sheetSpring:{duration:0}}><div className="sheet-handle" /><header className="sheet-heading"><h2>{title}</h2><button className="icon-button" aria-label={'关闭' + title} onClick={close}><X size={20} /></button></header>{children}</motion.div>
  </motion.dialog>
}
