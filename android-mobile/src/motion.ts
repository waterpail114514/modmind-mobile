import {useReducedMotion} from 'motion/react'

let keyboardInput=false
window.addEventListener('keydown',()=>{keyboardInput=true},{capture:true})
window.addEventListener('pointerdown',()=>{keyboardInput=false},{capture:true,passive:true})
export function useMobileMotion(){return {reduce:Boolean(useReducedMotion()),keyboard:keyboardInput}}
export const mobileEase=[.23,1,.32,1] as const
export const sheetSpring={type:'spring' as const,bounce:0,duration:.25}
