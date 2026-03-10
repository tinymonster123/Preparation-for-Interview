import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// 注意：故意去掉 StrictMode
// StrictMode 会让组件 render 两次，干扰实验观察
// 生产项目中请保留 StrictMode
createRoot(document.getElementById('root')).render(<App />)
