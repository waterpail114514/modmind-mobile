import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '../../src/renderer/src/theme-tokens.css'
import './mobile.css'
const mode = localStorage.getItem('modmind.mobile.theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
document.documentElement.dataset.themeMode = mode
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)
