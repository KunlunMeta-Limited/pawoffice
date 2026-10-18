import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { configureCharacterResources } from '@pawoffice/assets-office/frame/resources'
import { textureLoadQueue } from '@pawoffice/animation-frame/AssetLoadQueue'
import { configureOfficeAssets } from '@pawoffice/scene-office/pixi'

configureCharacterResources(`${import.meta.env.BASE_URL}characters`)
configureOfficeAssets({ baseUrl: `${import.meta.env.BASE_URL}assets/office`, schedule: job => textureLoadQueue.run(job) })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
