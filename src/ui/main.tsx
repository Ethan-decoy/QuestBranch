import React from 'react'
import ReactDOM from 'react-dom/client'
import '../i18n'
import { App } from './App'
import '@xyflow/react/dist/style.css'
import './styles.css'
import './graph.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
