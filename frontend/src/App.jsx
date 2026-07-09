import React, { useState, useEffect, useRef, useMemo } from 'react'
import { 
  Calendar, 
  Upload, 
  Download, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle2, 
  Info, 
  FileText, 
  Globe, 
  Sparkles, 
  Clock,
  Lock,
  X,
  Printer,
  Eye,
  Sun,
  Moon
} from 'lucide-react'

import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'


// Regular expression to validate HH:MM time format
const TIME_REGEX = /^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/

const DEFAULT_LAT = -7.7837217165
const DEFAULT_LNG = 110.4329516476

// Helper to get randomized location within 30 meters of default
function getRandomizedLocation() {
  const radius = 30; // 30 meters
  const r = radius * Math.sqrt(Math.random());
  const theta = Math.random() * 2 * Math.PI;
  const dy = r * Math.sin(theta);
  const dx = r * Math.cos(theta);
  
  const deltaLat = dy / 111111;
  const deltaLng = dx / (111111 * Math.cos(DEFAULT_LAT * Math.PI / 180));
  
  return {
    latitude: (DEFAULT_LAT + deltaLat).toFixed(10),
    longitude: (DEFAULT_LNG + deltaLng).toFixed(10)
  };
}

// Custom Leaflet SVG Icon to prevent bundle resolving issues in Vite
const MAP_MARKER_ICON = new L.Icon({
  iconUrl: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23ef4444" width="36" height="36"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>',
  iconSize: [36, 36],
  iconAnchor: [18, 36],
  popupAnchor: [0, -36]
})

// Helper component to center leaflet map on external coordinate updates (e.g. inputs, GPS buttons)
function MapCenterController({ center }) {
  const map = useMap()
  useEffect(() => {
    if (center && center[0] !== undefined && center[1] !== undefined) {
      map.setView(center, map.getZoom())
    }
  }, [center, map])
  return null
}

// Helper component to handle user click on map
function MapClickHandler({ onLocationSelect }) {
  useMapEvents({
    click(e) {
      onLocationSelect(e.latlng.lat, e.latlng.lng)
    }
  })
  return null
}

// Helper component for draggable marker that updates state on dragend
function CoordinateMarker({ position, onPositionChange }) {
  const markerRef = useRef(null)
  const eventHandlers = useMemo(
    () => ({
      dragend() {
        const marker = markerRef.current
        if (marker != null) {
          const latLng = marker.getLatLng()
          onPositionChange(latLng.lat, latLng.lng)
        }
      },
    }),
    [onPositionChange]
  )
  
  return (
    <Marker
      draggable={true}
      eventHandlers={eventHandlers}
      position={position}
      icon={MAP_MARKER_ICON}
      ref={markerRef}
    />
  )
}

export default function App() {
  // App connection & states
  const [isConnected, setIsConnected] = useState(false)
  const [activeTab, setActiveTab] = useState('fetch') // 'fetch' or 'upload'
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [toasts, setToasts] = useState([])
  
  // Form inputs
  const [month, setMonth] = useState('2026-05')
  const [sessionCookie, setSessionCookie] = useState('')
  const [authMethod, setAuthMethod] = useState('login') // 'login' or 'cookie'
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [userDisplayName, setUserDisplayName] = useState('')
  
  // Attendance table states
  const [tableData, setTableData] = useState([])
  const [year, setYear] = useState(null)
  const [monthNum, setMonthNum] = useState(null)
  const [dragActive, setDragActive] = useState(false)

  // Template states stored in browser localStorage for multi-user isolation
  const [templateStatus, setTemplateStatus] = useState(() => {
    const isCustom = localStorage.getItem('absen_template_is_custom') === 'true'
    const activeName = localStorage.getItem('absen_template_name') || 'template_absen.xlsx'
    return {
      is_custom: isCustom,
      active_template: activeName,
      available_templates: isCustom ? [activeName] : ['template_absen.xlsx']
    }
  })
  const [customTemplateB64, setCustomTemplateB64] = useState(() => {
    return localStorage.getItem('absen_custom_template_b64') || ''
  })
  const [isUploadingTemplate, setIsUploadingTemplate] = useState(false)

  // Preview & PDF states
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [pdfSupported, setPdfSupported] = useState(false)
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false)

  // Remote Attendance states (randomized within 30m of default location on refresh)
  const [coords, setCoords] = useState(getRandomizedLocation)
  const latitude = coords.latitude
  const longitude = coords.longitude
  const setLatitude = (lat) => setCoords(prev => ({ ...prev, latitude: typeof lat === 'function' ? lat(prev.latitude) : lat }))
  const setLongitude = (lng) => setCoords(prev => ({ ...prev, longitude: typeof lng === 'function' ? lng(prev.longitude) : lng }))
  const [isSubmittingRemote, setIsSubmittingRemote] = useState(false)
  const [deviceToken, setDeviceToken] = useState('')
  const [isIphoneModalOpen, setIsIphoneModalOpen] = useState(false)
  const [loggedInUsername, setLoggedInUsername] = useState('')
  const [guideBrowser, setGuideBrowser] = useState('chrome')

  // Theme state: 'dark' or 'light'
  const [theme, setTheme] = useState(() => {
    const storedTheme = localStorage.getItem('absen_theme')
    if (storedTheme) {
      return storedTheme
    }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    return prefersDark ? 'dark' : 'light'
  })

  // Sync theme to document element class list
  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light')
    } else {
      document.documentElement.classList.remove('light')
    }
    localStorage.setItem('absen_theme', theme)
  }, [theme])

  // Load session cookies from localStorage on boot
  useEffect(() => {
    const storedCookie = localStorage.getItem('absen_session_cookie')
    const storedName = localStorage.getItem('absen_user_name')
    const storedDeviceToken = localStorage.getItem('absen_device_token')
    const storedUserId = localStorage.getItem('absen_user_id')
    if (storedCookie) {
      setSessionCookie(storedCookie)
    }
    if (storedName) {
      setUserDisplayName(storedName)
    }
    if (storedDeviceToken) {
      setDeviceToken(storedDeviceToken)
    }
    if (storedUserId) {
      setLoggedInUsername(storedUserId)
    }
  }, [])

  // Fetch device token from server on boot or login change
  useEffect(() => {
    const loadDeviceTokenFromServer = async () => {
      const activeUser = loggedInUsername || localStorage.getItem('absen_user_id') || ''
      try {
        const res = await fetch(`/api/get-device-token?username=${activeUser}`)
        if (res.ok) {
          const data = await res.json()
          if (data.device_token) {
            setDeviceToken(data.device_token)
            localStorage.setItem('absen_device_token', data.device_token)
          }
        }
      } catch (err) {
        console.error('Failed to fetch device token from server:', err)
      }
    }
    
    if (isConnected) {
      loadDeviceTokenFromServer()
    }
  }, [loggedInUsername, isConnected])



  // Connection health check
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const res = await fetch('/api/health')
        if (res.ok) {
          setIsConnected(true)
          const data = await res.json()
          if (data && typeof data.pdf_supported !== 'undefined') {
            setPdfSupported(data.pdf_supported)
          }
        } else {
          setIsConnected(false)
        }
      } catch (err) {
        setIsConnected(false)
      }
    }
    
    checkConnection()
    // Poll connection every 10 seconds
    const interval = setInterval(checkConnection, 10000)
    return () => clearInterval(interval)
  }, [])

  // Toast Helper
  const addToast = (type, message) => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4000)
  }

  // Parse server records and build state
  const handleParsingSuccess = (data) => {
    setYear(data.year)
    setMonthNum(data.month)
    
    // Process records, adding type field ('holiday' or 'normal') for easier UI manipulation
    const processed = data.records.map(r => {
      const d = new Date(data.year, data.month - 1, r.tgl)
      const dayOfWeek = d.getDay() // 0 = Sunday, 6 = Saturday
      const isWknd = dayOfWeek === 0 || dayOfWeek === 6
      
      // Check if there is actual attendance (masuk or pulang has values and not empty or '-')
      const hasActualAttendance = (r.masuk && r.masuk !== '-' && r.masuk.trim() !== '') || 
                                  (r.pulang && r.pulang !== '-' && r.pulang.trim() !== '')

      // Auto-detect and select as normal day if any check-in/out record is detected during holidays
      const isHoliday = (r.is_holiday_or_leave || isWknd) && !hasActualAttendance
      
      let keterangan = r.keterangan
      if (isHoliday) {
        if (isWknd && !keterangan) {
          keterangan = dayOfWeek === 6 ? 'LIBUR - SABTU' : 'LIBUR - MINGGU'
        }
      } else {
        keterangan = null
      }

      return {
        ...r,
        keterangan: keterangan,
        rowType: isHoliday ? 'holiday' : 'normal',
        is_holiday_or_leave: isHoliday,
        has_attendance: hasActualAttendance || r.has_attendance,
        // Keep track of validation states
        masukInvalid: r.masuk && r.masuk !== '-' && !TIME_REGEX.test(r.masuk),
        pulangInvalid: r.pulang && r.pulang !== '-' && !TIME_REGEX.test(r.pulang)
      }
    })
    
    setTableData(processed)
    setErrorMessage('')
    addToast('success', `Loaded ${processed.length} attendance records for ${data.month}-${data.year}`)
  }

  // Action: Fetch URL from Backend Proxy using a specific cookie
  const fetchDataWithCookie = async (cookieString) => {
    setIsLoading(true)
    setErrorMessage('')
    
    try {
      const res = await fetch('/api/fetch-html-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: month,
          session_cookie: cookieString
        })
      })
      
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || `Server responded with status ${res.status}`)
      }
      
      handleParsingSuccess(data)
    } catch (err) {
      loggerError(err)
      setErrorMessage(err.message)
      addToast('error', `Fetch failed: ${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  // Wrapper for manual cookie fetch form
  const handleFetchData = async (e) => {
    e.preventDefault()
    fetchDataWithCookie(sessionCookie)
  }

  // Action: Authenticate with ksps.co.id and retrieve cookies
  const handleLogin = async (e) => {
    e.preventDefault()
    setIsLoading(true)
    setErrorMessage('')
    
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed')
      }
      
      setSessionCookie(data.session_cookie)
      setUserDisplayName(data.display_name)
      setLoggedInUsername(data.username || username)
      
      localStorage.setItem('absen_session_cookie', data.session_cookie)
      localStorage.setItem('absen_user_name', data.display_name)
      localStorage.setItem('absen_user_id', data.username || username)
      
      if (data.device_token) {
        setDeviceToken(data.device_token)
        localStorage.setItem('absen_device_token', data.device_token)
      }
      
      addToast('success', `Logged in successfully as ${data.display_name}`)
      
      // Automatically fetch attendance after successful login
      await fetchDataWithCookie(data.session_cookie)
    } catch (err) {
      loggerError(err)
      setErrorMessage(err.message)
      addToast('error', `Login failed: ${err.message}`)
      setIsLoading(false)
    }
  }

  // Action: Logout and clear session
  const handleLogout = () => {
    setSessionCookie('')
    setUserDisplayName('')
    setLoggedInUsername('')
    localStorage.removeItem('absen_session_cookie')
    localStorage.removeItem('absen_user_name')
    localStorage.removeItem('absen_user_id')
    addToast('info', 'Logged out. Session cookies cleared.')
  }

  // Action: Download current template (either local custom or default from server)
  const handleDownloadTemplate = async () => {
    try {
      if (templateStatus.is_custom && customTemplateB64) {
        const byteCharacters = atob(customTemplateB64)
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const byteArray = new Uint8Array(byteNumbers)
        const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
        
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = templateStatus.active_template || 'template_custom.xlsx'
        document.body.appendChild(a)
        a.click()
        a.remove()
        window.URL.revokeObjectURL(url)
        addToast('success', 'Custom Excel template downloaded from your local browser storage.')
      } else {
        const response = await fetch('/api/download-template')
        if (!response.ok) throw new Error('Failed to download template')
        
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'template_absen.xlsx'
        document.body.appendChild(a)
        a.click()
        a.remove()
        window.URL.revokeObjectURL(url)
        addToast('success', 'Default Excel template downloaded successfully.')
      }
    } catch (err) {
      console.error(err)
      addToast('error', `Download failed: ${err.message}`)
    }
  }

  // Action: Upload custom template (saves to browser localStorage)
  const handleUploadTemplate = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    
    if (!file.name.endsWith('.xlsx')) {
      addToast('error', 'Only .xlsx files are supported.')
      return
    }
    
    setIsUploadingTemplate(true)
    
    try {
      const reader = new FileReader()
      reader.onload = (event) => {
        try {
          const arrayBuffer = event.target.result
          const bytes = new Uint8Array(arrayBuffer)
          let binary = ''
          const len = bytes.byteLength
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i])
          }
          const base64String = window.btoa(binary)
          
          localStorage.setItem('absen_template_is_custom', 'true')
          localStorage.setItem('absen_template_name', file.name)
          localStorage.setItem('absen_custom_template_b64', base64String)
          
          setCustomTemplateB64(base64String)
          setTemplateStatus({
            is_custom: true,
            active_template: file.name,
            available_templates: [file.name]
          })
          
          addToast('success', 'Custom template uploaded and saved locally in your browser!')
        } catch (innerErr) {
          console.error(innerErr)
          addToast('error', `Failed to process template: ${innerErr.message}`)
        } finally {
          setIsUploadingTemplate(false)
        }
      }
      
      reader.onerror = () => {
        addToast('error', 'Failed to read file.')
        setIsUploadingTemplate(false)
      }
      
      reader.readAsArrayBuffer(file)
    } catch (err) {
      console.error(err)
      addToast('error', `Upload failed: ${err.message}`)
      setIsUploadingTemplate(false)
    } finally {
      e.target.value = ''
    }
  }

  // Action: Reset custom template (removes from browser localStorage)
  const handleResetTemplate = () => {
    localStorage.removeItem('absen_template_is_custom')
    localStorage.removeItem('absen_template_name')
    localStorage.removeItem('absen_custom_template_b64')
    
    setCustomTemplateB64('')
    setTemplateStatus({
      is_custom: false,
      active_template: 'template_absen.xlsx',
      available_templates: ['template_absen.xlsx']
    })
    addToast('success', 'Reverted to default template.')
  }

  // Action: Upload HTML File
  const handleFileUpload = async (file) => {
    if (!file) return
    setIsLoading(true)
    setErrorMessage('')
    
    const formData = new FormData()
    formData.append('file', file)
    
    try {
      const res = await fetch('/api/parse-html-file', {
        method: 'POST',
        body: formData
      })
      
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || `Upload failed with status ${res.status}`)
      }
      
      handleParsingSuccess(data)
    } catch (err) {
      loggerError(err)
      setErrorMessage(err.message)
      addToast('error', `Parsing failed: ${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  // File Input Handler
  const onFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0])
    }
  }

  // Drag-and-drop Handlers
  const handleDrag = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0])
    }
  }

  // Detect weekends inside JS
  const getWeekdayName = (dayNum) => {
    if (!year || !monthNum) return ''
    const d = new Date(year, monthNum - 1, dayNum)
    return d.toLocaleDateString('id-ID', { weekday: 'long' })
  }

  const isWeekend = (dayNum) => {
    if (!year || !monthNum) return false
    const d = new Date(year, monthNum - 1, dayNum)
    const day = d.getDay()
    return day === 0 || day === 6 // 0=Sunday, 6=Saturday
  }

  const getWeekendLabel = (dayNum) => {
    if (!year || !monthNum) return ''
    const d = new Date(year, monthNum - 1, dayNum)
    const day = d.getDay()
    if (day === 6) return 'LIBUR - SABTU'
    if (day === 0) return 'LIBUR - MINGGU'
    return ''
  }

  // Table Change Handlers
  const handleRowTypeChange = (index, newType) => {
    const updated = [...tableData]
    const row = updated[index]
    row.rowType = newType
    
    if (newType === 'holiday') {
      // Clear times and set remark
      row.masuk = null
      row.pulang = null
      row.masukInvalid = false
      row.pulangInvalid = false
      // Set to weekend label if weekend, otherwise generic LIBUR
      row.keterangan = isWeekend(row.tgl) ? getWeekendLabel(row.tgl) : 'LIBUR'
      row.is_holiday_or_leave = true
      row.has_attendance = false
    } else {
      // Set to normal attendance
      row.keterangan = null
      row.masuk = ''
      row.pulang = ''
      row.is_holiday_or_leave = false
      row.has_attendance = false
    }
    
    setTableData(updated)
  }

  const formatTimeInput = (value, prevValue = '') => {
    if (value === '-') {
      return '-';
    }
    
    // If deleting, don't auto-append colon
    if (prevValue && value.length < prevValue.length) {
      return value;
    }

    // Clean non-digits
    let clean = value.replace(/[^0-9]/g, '');
    if (clean.length > 4) {
      clean = clean.slice(0, 4);
    }

    if (clean.length > 2) {
      return `${clean.slice(0, 2)}:${clean.slice(2)}`;
    } else if (clean.length === 2) {
      return `${clean}:`;
    }
    return clean;
  };

  const handleCellChange = (index, field, value) => {
    const updated = [...tableData]
    const row = updated[index]
    
    let processedValue = value;
    if (field === 'masuk' || field === 'pulang') {
      processedValue = formatTimeInput(value, row[field] || '');
    }
    
    row[field] = processedValue === '' ? null : processedValue
    
    // Perform validations
    if (field === 'masuk') {
      row.masukInvalid = processedValue !== '' && processedValue !== '-' && !TIME_REGEX.test(processedValue)
      row.has_attendance = (row.masuk !== null && row.masuk !== '') || (row.pulang !== null && row.pulang !== '')
    }
    if (field === 'pulang') {
      row.pulangInvalid = processedValue !== '' && processedValue !== '-' && !TIME_REGEX.test(processedValue)
      row.has_attendance = (row.masuk !== null && row.masuk !== '') || (row.pulang !== null && row.pulang !== '')
    }
    if (field === 'keterangan') {
      row.is_holiday_or_leave = processedValue !== null && processedValue !== ''
    }
    
    setTableData(updated)
  }

  // Action: Call XLSX generation endpoint and download file
  const handleGenerateXLSX = async () => {
    if (tableData.length === 0) return
    
    // Check if there are any validation errors
    const hasErrors = tableData.some(r => r.masukInvalid || r.pulangInvalid)
    if (hasErrors) {
      addToast('error', 'Please correct invalid check-in/out times (format must be HH:MM) before generating Excel.')
      return
    }

    setIsLoading(true)
    try {
      const res = await fetch('/api/generate-xlsx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: year,
          month: monthNum,
          custom_template: customTemplateB64 || null,
          records: tableData.map(r => ({
            tgl: r.tgl,
            masuk: r.rowType === 'holiday' ? null : r.masuk,
            pulang: r.rowType === 'holiday' ? null : r.pulang,
            keterangan: r.rowType === 'holiday' ? r.keterangan : null
          }))
        })
      })

      if (!res.ok) {
        const errorText = await res.text()
        throw new Error(errorText || 'Failed to generate Excel file')
      }

      // Handle binary file download
      const blob = await res.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      
      const fileMonth = monthNum.toString().padStart(2, '0')
      link.download = `Absen_Bulan_${fileMonth}-${year}.xlsx`
      
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(downloadUrl)
      
      addToast('success', 'Excel file generated and download started!')
    } catch (err) {
      loggerError(err)
      addToast('error', `Generation failed: ${err.message}`)
    } finally {
      setIsLoading(false)
    }
  }

  // Action: Call preview endpoint and show preview modal
  const handleShowPreview = async () => {
    if (tableData.length === 0) return
    
    const hasErrors = tableData.some(r => r.masukInvalid || r.pulangInvalid)
    if (hasErrors) {
      addToast('error', 'Please correct invalid check-in/out times before previewing.')
      return
    }

    setIsGeneratingPreview(true)
    setErrorMessage('')
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: year,
          month: monthNum,
          custom_template: customTemplateB64 || null,
          records: tableData.map(r => ({
            tgl: r.tgl,
            masuk: r.rowType === 'holiday' ? null : r.masuk,
            pulang: r.rowType === 'holiday' ? null : r.pulang,
            keterangan: r.rowType === 'holiday' ? r.keterangan : null
          }))
        })
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate preview')
      }

      setPreviewHtml(data.html)
      setIsPreviewOpen(true)
      addToast('success', 'Preview loaded successfully!')
    } catch (err) {
      loggerError(err)
      addToast('error', `Preview failed: ${err.message}`)
    } finally {
      setIsGeneratingPreview(false)
    }
  }

  // Action: Delegate print command to iframe
  const handlePrintPreview = () => {
    const iframe = document.getElementById('preview-iframe')
    if (iframe) {
      iframe.contentWindow.focus()
      iframe.contentWindow.print()
    } else {
      addToast('error', 'Could not locate preview iframe.')
    }
  }

  // Action: Call PDF generation endpoint and download file
  const handleDownloadPDF = async () => {
    if (tableData.length === 0) return

    setIsGeneratingPdf(true)
    try {
      const res = await fetch('/api/generate-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          year: year,
          month: monthNum,
          custom_template: customTemplateB64 || null,
          records: tableData.map(r => ({
            tgl: r.tgl,
            masuk: r.rowType === 'holiday' ? null : r.masuk,
            pulang: r.rowType === 'holiday' ? null : r.pulang,
            keterangan: r.rowType === 'holiday' ? r.keterangan : null
          }))
        })
      })

      if (!res.ok) {
        const contentType = res.headers.get('content-type')
        if (contentType && contentType.includes('application/json')) {
          const errData = await res.json()
          throw new Error(errData.error || 'Failed to generate PDF')
        } else {
          const errText = await res.text()
          throw new Error(errText || 'Failed to generate PDF')
        }
      }

      const blob = await res.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      
      const fileMonth = monthNum.toString().padStart(2, '0')
      link.download = `Absen_Bulan_${fileMonth}-${year}.pdf`
      
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(downloadUrl)
      
      addToast('success', 'PDF downloaded successfully!')
    } catch (err) {
      loggerError(err)
      addToast('error', `PDF download failed: ${err.message}`)
    } finally {
      setIsGeneratingPdf(false)
    }
  }

  // Statistics Calculations
  const stats = {
    total: tableData.length,
    present: tableData.filter(r => r.rowType === 'normal' && r.masuk && r.masuk !== '-').length,
    holidays: tableData.filter(r => r.rowType === 'holiday').length,
    unrecorded: tableData.filter(r => r.rowType === 'normal' && (!r.masuk || r.masuk === '-')).length
  }

  // Developer logging handler
  const loggerError = (err) => {
    console.error(err)
  }

  // Get user location using browser GPS
  const handleGetLocation = () => {
    if (!navigator.geolocation) {
      addToast('error', 'Geolocation is not supported by your browser')
      return
    }
    
    addToast('info', 'Retrieving GPS coordinates...')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(10))
        setLongitude(position.coords.longitude.toFixed(10))
        addToast('success', 'Location updated from browser GPS!')
      },
      (error) => {
        addToast('error', `Geolocation failed: ${error.message}`)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  // Send Remote Check-In / Check-Out
  const handleRemoteAbsen = async (statusVal) => {
    if (!sessionCookie) {
      addToast('error', 'Active session cookie is required.')
      return
    }
    
    setIsSubmittingRemote(true)
    try {
      const res = await fetch('/api/remote-absen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_cookie: sessionCookie,
          latitude: latitude,
          longitude: longitude,
          status: statusVal,
          device_token: deviceToken
        })
      })
      
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.message || data.error || `Server error: ${res.status}`)
      }
      
      if (data.status === 'success') {
        addToast('success', data.message || 'Remote attendance submitted successfully!')
      } else {
        addToast('error', data.message || 'Remote attendance failed.')
      }
    } catch (err) {
      console.error(err)
      addToast('error', `Failed: ${err.message}`)
    } finally {
      setIsSubmittingRemote(false)
    }
  }

  const saveTokenToServer = async (tokenValue) => {
    const activeUser = loggedInUsername || localStorage.getItem('absen_user_id') || 'default'
    try {
      await fetch('/api/save-device-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: activeUser, device_token: tokenValue })
      })
    } catch (err) {
      console.error('Failed to sync device token to server:', err)
    }
  }

  const handleCopyBookmarklet = () => {
    const text = `javascript:(function(){var t=localStorage.getItem('token');if(t){alert('Your Device Token:\\n\\n'+t);console.log(t);}else{alert('Token not found. Make sure you are on ksps.co.id/eksternal/');}})();`
    
    // Primary: Clipboard API (if available and secure context)
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
        .then(() => addToast('success', 'Bookmarklet code copied to clipboard!'))
        .catch(() => fallbackCopy(text))
    } else {
      fallbackCopy(text)
    }
  }

  const fallbackCopy = (text) => {
    try {
      const textArea = document.createElement("textarea")
      textArea.value = text
      textArea.style.top = "0"
      textArea.style.left = "0"
      textArea.style.position = "fixed"
      textArea.style.opacity = "0"
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      
      const successful = document.execCommand('copy')
      document.body.removeChild(textArea)
      
      if (successful) {
        addToast('success', 'Bookmarklet code copied to clipboard!')
      } else {
        addToast('error', 'Failed to copy code. Please manually select and copy the text box.')
      }
    } catch (err) {
      console.error('Fallback copy failed:', err)
      addToast('error', 'Failed to copy code. Please manually select and copy the text box.')
    }
  }



  return (
    <div className="app-container">
      {/* Toast Messages */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === 'success' && <CheckCircle2 className="alert-icon" size={18} color="#10b981" />}
            {t.type === 'error' && <AlertCircle className="alert-icon" size={18} color="#ef4444" />}
            {t.type === 'info' && <Info className="alert-icon" size={18} color="#3b82f6" />}
            <span style={{ fontSize: '0.9rem', flexGrow: 1 }}>{t.message}</span>
            <button onClick={() => setToasts(prev => prev.filter(item => item.id !== t.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Header Panel */}
      <header className="glass-panel app-header">
        <div className="logo-section">
          <Calendar className="logo-icon" size={32} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <h1 className="logo-title">Absen Pro</h1>
              <span className="logo-badge">XLSX Gen</span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
              Attendance Fetcher, Editor & Excel Builder
            </p>
          </div>
        </div>
        
        <div className="header-actions">
          <button
            onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
            className="btn btn-secondary"
            style={{ 
              padding: '0.5rem', 
              borderRadius: '50%', 
              width: '38px', 
              height: '38px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              cursor: 'pointer'
            }}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle Theme"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          <div className="server-status">
            <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}></div>
            <span>{isConnected ? 'Backend Connected' : 'Connecting Backend...'}</span>
          </div>
        </div>
      </header>

      {/* Main Form and Actions panel */}
      <main className="control-grid">
        {/* Left Card: Input Panel */}
        <section className="glass-panel">
          <div className="tabs-header">
            <button 
              className={`tab-btn ${activeTab === 'fetch' ? 'active' : ''}`}
              onClick={() => { setActiveTab('fetch'); setErrorMessage(''); }}
            >
              <Globe size={16} />
              Fetch from Website
            </button>
            <button 
              className={`tab-btn ${activeTab === 'upload' ? 'active' : ''}`}
              onClick={() => { setActiveTab('upload'); setErrorMessage(''); }}
            >
              <Upload size={16} />
              Upload HTML File
            </button>
          </div>

          {activeTab === 'fetch' ? (
            <div>
              {/* Fetch method selector */}
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', padding: '0.25rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    background: authMethod === 'login' ? 'rgba(255,255,255,0.08)' : 'transparent',
                    border: 'none',
                    color: authMethod === 'login' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    padding: '0.5rem',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    fontFamily: 'var(--font-sans)'
                  }}
                  onClick={() => { setAuthMethod('login'); setErrorMessage(''); }}
                >
                  Automatic Login
                </button>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    background: authMethod === 'cookie' ? 'rgba(255,255,255,0.08)' : 'transparent',
                    border: 'none',
                    color: authMethod === 'cookie' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    padding: '0.5rem',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    fontFamily: 'var(--font-sans)'
                  }}
                  onClick={() => { setAuthMethod('cookie'); setErrorMessage(''); }}
                >
                  Manual Cookies
                </button>
              </div>

              {authMethod === 'login' ? (
                /* Method A: Automatic Login */
                sessionCookie && userDisplayName ? (
                  /* Logged in state */
                  <div>
                    <div style={{ 
                      background: 'rgba(16, 185, 129, 0.06)', 
                      border: '1px solid rgba(16, 185, 129, 0.2)', 
                      borderRadius: '8px', 
                      padding: '1rem', 
                      marginBottom: '1.25rem', 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center' 
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <CheckCircle2 color="var(--color-success)" size={20} />
                        <div>
                          <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>Active Session Found</p>
                          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>User: {userDisplayName}</p>
                        </div>
                      </div>
                      <button 
                        onClick={handleLogout}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--color-danger)',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          fontFamily: 'var(--font-sans)'
                        }}
                      >
                        Logout
                      </button>
                    </div>

                    <form onSubmit={(e) => { e.preventDefault(); fetchDataWithCookie(sessionCookie); }}>
                      <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                        <label htmlFor="month">
                          <Calendar size={14} />
                          Select Month
                        </label>
                        <input 
                          type="month" 
                          id="month" 
                          value={month}
                          onChange={(e) => setMonth(e.target.value)}
                          required
                        />
                      </div>

                      <button 
                        type="submit" 
                        className="btn btn-primary" 
                        style={{ width: '100%' }}
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <>
                            <RefreshCw className="spinner" size={16} />
                            Fetching Attendance Table...
                          </>
                        ) : (
                          <>
                            <Globe size={16} />
                            Fetch Attendance
                          </>
                        )}
                      </button>
                    </form>
                  </div>
                ) : (
                  /* Logged out / input credentials state */
                  <form onSubmit={handleLogin}>
                    <div className="form-group">
                      <label htmlFor="username">Username / NIK</label>
                      <input 
                        type="text" 
                        id="username" 
                        placeholder="Enter NIK (e.g. 3259800588)"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor="password">Password</label>
                      <input 
                        type="password" 
                        id="password" 
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                      <label htmlFor="month">Select Month</label>
                      <input 
                        type="month" 
                        id="month" 
                        value={month}
                        onChange={(e) => setMonth(e.target.value)}
                        required
                      />
                    </div>

                    <button 
                      type="submit" 
                      className="btn btn-primary" 
                      style={{ width: '100%' }}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <>
                          <RefreshCw className="spinner" size={16} />
                          Logging in & Fetching...
                        </>
                      ) : (
                        <>
                          <Lock size={16} />
                          Login & Fetch Attendance
                        </>
                      )}
                    </button>
                  </form>
                )
              ) : (
                /* Method B: Manual Cookies */
                <form onSubmit={handleFetchData}>
                  <div className="form-group">
                    <label htmlFor="month">
                      <Calendar size={14} />
                      Select Month
                    </label>
                    <input 
                      type="month" 
                      id="month" 
                      value={month}
                      onChange={(e) => setMonth(e.target.value)}
                      required
                    />
                  </div>
                  
                  <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                    <label htmlFor="cookie">
                      <Lock size={14} />
                      Session Cookie String
                    </label>
                    <input 
                      type="text" 
                      id="cookie" 
                      placeholder="PHPSESSID=...; _csrf-absen-bisnis=..."
                      value={sessionCookie}
                      onChange={(e) => setSessionCookie(e.target.value)}
                      required
                    />
                  </div>

                  <button 
                    type="submit" 
                    className="btn btn-primary" 
                    style={{ width: '100%' }}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <RefreshCw className="spinner" size={16} />
                        Fetching Attendance...
                      </>
                    ) : (
                      <>
                        <Globe size={16} />
                        Fetch Attendance Table
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          ) : (
            <div>
              <div 
                className={`dropzone ${dragActive ? 'active' : ''}`}
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => document.getElementById('file-upload-input').click()}
              >
                <input 
                  type="file" 
                  id="file-upload-input" 
                  accept=".html" 
                  onChange={onFileChange} 
                  style={{ display: 'none' }} 
                />
                <Upload className="dropzone-icon" size={40} />
                <div>
                  <p style={{ fontWeight: 600, fontSize: '0.95rem' }}>Drag and drop your attendance HTML file here</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>or click to browse local files</p>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '0.35rem 0.75rem', borderRadius: '4px', fontSize: '0.75rem', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
                  Accepts .html files exported from ksps.co.id
                </div>
              </div>

              {isLoading && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginTop: '1.25rem', color: 'var(--text-secondary)' }}>
                  <RefreshCw className="spinner" size={16} />
                  <span>Uploading and parsing files...</span>
                </div>
              )}
            </div>
          )}

          {sessionCookie && (loggedInUsername === '3259800588' || (userDisplayName && userDisplayName.includes('WIBI CHAMIM MUSHODIQ'))) && (
            <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                <Clock className="logo-icon" size={20} style={{ color: 'var(--color-primary)' }} />
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>Remote Attendance Punch</h3>
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label htmlFor="deviceToken" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Device Token (localStorage 'token' on ksps.co.id)</span>
                  <button
                    type="button"
                    onClick={() => setIsIphoneModalOpen(true)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--color-primary)',
                      fontSize: '0.7rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: 0
                    }}
                  >
                    iPhone Guide
                  </button>
                </label>
                <input 
                  type="text" 
                  id="deviceToken" 
                  value={deviceToken}
                  onChange={(e) => {
                    setDeviceToken(e.target.value)
                    localStorage.setItem('absen_device_token', e.target.value)
                  }}
                  onBlur={(e) => saveTokenToServer(e.target.value)}
                  placeholder="Paste your registered device token..."
                  style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                />
              </div>
              
              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label htmlFor="latitude" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>Latitude (Lintang)</label>
                  <input 
                    type="text" 
                    id="latitude" 
                    value={latitude}
                    onChange={(e) => setLatitude(e.target.value)}
                    placeholder="-7.7837217165"
                    style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                  />
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label htmlFor="longitude" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>Longitude (Bujur)</label>
                  <input 
                    type="text" 
                    id="longitude" 
                    value={longitude}
                    onChange={(e) => setLongitude(e.target.value)}
                    placeholder="110.4329516476"
                    style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', marginTop: '0.75rem' }}>
                <button
                  type="button"
                  onClick={handleGetLocation}
                  className="btn btn-secondary"
                  style={{ flex: 1, padding: '0.5rem', fontSize: '0.8rem', minHeight: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}
                >
                  <Globe size={14} />
                  Get GPS Location
                </button>
              </div>

              <div className="map-container-wrapper">
                <MapContainer
                  center={[
                    isNaN(parseFloat(latitude)) ? DEFAULT_LAT : parseFloat(latitude),
                    isNaN(parseFloat(longitude)) ? DEFAULT_LNG : parseFloat(longitude)
                  ]}
                  zoom={15}
                  scrollWheelZoom={true}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <CoordinateMarker
                    position={[
                      isNaN(parseFloat(latitude)) ? DEFAULT_LAT : parseFloat(latitude),
                      isNaN(parseFloat(longitude)) ? DEFAULT_LNG : parseFloat(longitude)
                    ]}
                    onPositionChange={(lat, lng) => {
                      setLatitude(lat.toFixed(10))
                      setLongitude(lng.toFixed(10))
                    }}
                  />
                  <MapClickHandler
                    onLocationSelect={(lat, lng) => {
                      setLatitude(lat.toFixed(10))
                      setLongitude(lng.toFixed(10))
                    }}
                  />
                  <MapCenterController
                    center={[
                      isNaN(parseFloat(latitude)) ? DEFAULT_LAT : parseFloat(latitude),
                      isNaN(parseFloat(longitude)) ? DEFAULT_LNG : parseFloat(longitude)
                    ]}
                  />
                </MapContainer>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => handleRemoteAbsen('0')}
                  className="btn btn-primary"
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                  disabled={isSubmittingRemote || isLoading}
                >
                  {isSubmittingRemote ? <RefreshCw className="spinner" size={16} /> : <CheckCircle2 size={16} />}
                  Check-In (Masuk)
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoteAbsen('1')}
                  className="btn btn-secondary"
                  style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', border: '1px solid var(--border-color)' }}
                  disabled={isSubmittingRemote || isLoading}
                >
                  {isSubmittingRemote ? <RefreshCw className="spinner" size={16} /> : <Clock size={16} />}
                  Check-Out (Pulang)
                </button>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="alert alert-danger" style={{ marginTop: '1.25rem' }}>
              <AlertCircle className="alert-icon" size={18} />
              <div>
                <strong style={{ display: 'block', marginBottom: '0.15rem' }}>Operation Failed</strong>
                {errorMessage}
              </div>
            </div>
          )}
        </section>

        {/* Right Card: Quick Info, Templates & Metrics */}
        <section className="glass-panel info-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div>
            <h2 className="info-title">Month Metadata</h2>
            {year && monthNum ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Calendar size={22} color="var(--color-primary)" />
                <div>
                  <p style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                    Period: {monthNum.toString().padStart(2, '0')}-{year}
                  </p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Parsed from HTML: {tableData.length} days total
                  </p>
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Info size={16} />
                <span>No attendance data loaded yet. Fetch or upload a report to populate.</span>
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
            <h2 className="info-title">Excel Template</h2>
            <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Active Template:</span>
                <span style={{ fontWeight: 600, color: 'var(--color-primary)', wordBreak: 'break-all', textAlign: 'right', paddingLeft: '0.5rem' }}>
                  {templateStatus.active_template}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Type:</span>
                <span style={{ color: templateStatus.is_custom ? 'var(--color-success)' : 'var(--text-primary)' }}>
                  {templateStatus.is_custom ? 'Custom Uploaded' : 'Default Template'}
                </span>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <button 
                  onClick={handleDownloadTemplate}
                  className="btn btn-secondary"
                  style={{ width: '100%', padding: '0.5rem', fontSize: '0.8rem', minHeight: 'auto' }}
                  title={templateStatus.is_custom ? `Download ${templateStatus.active_template}` : "Download template_absen.xlsx"}
                >
                  <Download size={14} />
                  {templateStatus.is_custom ? `Download ${templateStatus.active_template}` : "Download template_absen.xlsx"}
                </button>
                
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button 
                    onClick={() => document.getElementById('template-upload-input').click()}
                    className="btn btn-secondary"
                    style={{ flex: 1, padding: '0.5rem', fontSize: '0.8rem', minHeight: 'auto' }}
                    disabled={isUploadingTemplate}
                  >
                    <Upload size={14} />
                    {isUploadingTemplate ? 'Uploading...' : 'Upload Template'}
                  </button>
                  <input 
                    type="file" 
                    id="template-upload-input" 
                    accept=".xlsx" 
                    onChange={handleUploadTemplate} 
                    style={{ display: 'none' }} 
                  />
                  
                  {templateStatus.is_custom && (
                    <button 
                      onClick={handleResetTemplate}
                      className="btn btn-secondary btn-danger-outline"
                      style={{ padding: '0.5rem 0.75rem', fontSize: '0.8rem', minHeight: 'auto' }}
                      title="Reset back to default template"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
            <h2 className="info-title">Summary Statistics</h2>
            <div className="stats-grid" style={{ marginTop: '0.5rem' }}>
              <div className="stat-item">
                <div className="stat-val attendance">{stats.present}</div>
                <div className="stat-lbl">Present (Days)</div>
              </div>
              <div className="stat-item">
                <div className="stat-val holiday">{stats.holidays}</div>
                <div className="stat-lbl">Holidays/Wknds</div>
              </div>
              <div className="stat-item">
                <div className="stat-val empty">{stats.unrecorded}</div>
                <div className="stat-lbl">Empty/Absent</div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Editable Table Panel */}
      {tableData.length > 0 && (
        <section className="glass-panel table-section">
          <div className="table-header-row">
            <div>
              <h2 className="table-title">
                Edit Attendance Table: {monthNum.toString().padStart(2, '0')}-{year}
              </h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                Changes made here will be written into the Excel template upon download.
              </p>
            </div>
            
            <div className="table-actions">
              <button 
                onClick={handleShowPreview}
                className="btn btn-secondary table-action-btn"
                disabled={isLoading || isGeneratingPreview}
              >
                {isGeneratingPreview ? <RefreshCw className="spinner" size={16} /> : <Eye size={16} />}
                Show Preview & PDF
              </button>
              <button 
                onClick={handleGenerateXLSX}
                className="btn btn-success table-action-btn"
                disabled={isLoading}
              >
                <Download size={16} />
                Generate & Download XLSX
              </button>
            </div>
          </div>

          <div className="table-responsive-container">
            <table className="attendance-table">
              <thead>
                <tr>
                  <th style={{ width: '50px', textAlign: 'center' }}>Day</th>
                  <th style={{ width: '100px' }}>Weekday</th>
                  <th style={{ width: '130px' }}>Row Type</th>
                  <th style={{ width: '110px', textAlign: 'center' }}>Check-in (Masuk)</th>
                  <th style={{ width: '110px', textAlign: 'center' }}>Check-out (Pulang)</th>
                  <th>Holiday / Weekend Remark (Keterangan)</th>
                </tr>
              </thead>
              <tbody>
                {tableData.map((row, idx) => {
                  const weekend = isWeekend(row.tgl)
                  const weekdayName = getWeekdayName(row.tgl)
                  const isMasukEmpty = row.rowType === 'normal' && (!row.masuk || row.masuk === '-' || row.masuk.trim() === '')
                  const isPulangEmpty = row.rowType === 'normal' && (!row.pulang || row.pulang === '-' || row.pulang.trim() === '')
                  
                  return (
                    <tr 
                      key={row.tgl} 
                      className={
                        row.rowType === 'holiday' ? 'row-holiday' : (weekend ? 'row-weekend' : '')
                      }
                    >
                      <td className="text-center" style={{ fontWeight: 600 }}>{row.tgl}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                          {weekend && <Clock size={12} color="var(--text-muted)" />}
                          <span>{weekdayName}</span>
                        </div>
                      </td>
                      <td>
                        <select 
                          value={row.rowType} 
                          onChange={(e) => handleRowTypeChange(idx, e.target.value)}
                          className="cell-select"
                        >
                          <option value="normal">Normal Day</option>
                          <option value="holiday">Holiday/Leave</option>
                        </select>
                      </td>
                      
                      {row.rowType === 'holiday' ? (
                        /* Merged cells for holidays */
                        <td colSpan={3} className="row-holiday-merged-cell">
                          <input 
                            type="text"
                            value={row.keterangan || ''}
                            onChange={(e) => handleCellChange(idx, 'keterangan', e.target.value)}
                            placeholder="Enter Holiday or Leave reason..."
                            className="cell-input"
                            style={{ textAlign: 'center', fontWeight: 'bold' }}
                          />
                        </td>
                      ) : (
                        /* Normal cell inputs for attendance */
                        <>
                          <td>
                            <div className="cell-input-wrapper">
                              <input 
                                type="text" 
                                value={row.masuk || ''} 
                                onChange={(e) => handleCellChange(idx, 'masuk', e.target.value)}
                                placeholder="HH:MM"
                                className={`cell-input ${row.masukInvalid ? 'invalid' : (isMasukEmpty ? 'warning' : '')}`}
                                title="Time must be in 24h format (HH:MM) or empty / '-'"
                              />
                              {row.masukInvalid ? (
                                <div className="cell-error-text">
                                  Invalid HH:MM
                                </div>
                              ) : (
                                isMasukEmpty && (
                                  <div className="cell-warning-text">
                                    Missing check-in
                                  </div>
                                )
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="cell-input-wrapper">
                              <input 
                                type="text" 
                                value={row.pulang || ''} 
                                onChange={(e) => handleCellChange(idx, 'pulang', e.target.value)}
                                placeholder="HH:MM"
                                className={`cell-input ${row.pulangInvalid ? 'invalid' : (isPulangEmpty ? 'warning' : '')}`}
                                title="Time must be in 24h format (HH:MM) or empty / '-'"
                              />
                              {row.pulangInvalid ? (
                                <div className="cell-error-text">
                                  Invalid HH:MM
                                </div>
                              ) : (
                                isPulangEmpty && (
                                  <div className="cell-warning-text">
                                    Missing check-out
                                  </div>
                                )
                              )}
                            </div>
                          </td>
                          <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontStyle: 'italic' }}>
                            Ready to write attendance data
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="table-actions bottom-actions">
            <button 
              onClick={handleShowPreview}
              className="btn btn-secondary table-action-btn"
              disabled={isLoading || isGeneratingPreview}
            >
              {isGeneratingPreview ? <RefreshCw className="spinner" size={18} /> : <Eye size={18} />}
              Show Preview & PDF
            </button>
            <button 
              onClick={handleGenerateXLSX}
              className="btn btn-success table-action-btn"
              disabled={isLoading}
            >
              <Download size={18} />
              Generate & Download XLSX
            </button>
          </div>
        </section>
      )}
      {/* Print Preview Modal */}
      {isPreviewOpen && (
        <div className="preview-modal-backdrop" onClick={() => setIsPreviewOpen(false)}>
          <div className="preview-modal-container" onClick={(e) => e.stopPropagation()}>
            <div className="preview-modal-header">
              <div className="preview-modal-title">
                <FileText size={20} color="var(--color-primary)" />
                <span>Attendance Sheet Print Preview</span>
              </div>
              <div className="preview-modal-actions">
                <button 
                  onClick={handlePrintPreview}
                  className="btn btn-secondary preview-action-btn"
                >
                  <Printer size={15} />
                  <span>Print / Save as PDF</span>
                </button>
                <button 
                  onClick={handleDownloadPDF}
                  className="btn btn-primary preview-action-btn"
                  disabled={isGeneratingPdf}
                >
                  {isGeneratingPdf ? <RefreshCw className="spinner" size={15} /> : <Download size={15} />}
                  <span>{pdfSupported ? 'Download PDF' : 'Download PDF (Fallback)'}</span>
                </button>
                <button 
                  onClick={() => setIsPreviewOpen(false)}
                  className="btn btn-secondary preview-close-btn"
                  title="Close Preview"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            
            <div className="preview-modal-body">
              {!pdfSupported && (
                <div className="preview-tip-banner">
                  <Info size={16} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                  <div>
                    <strong>LibreOffice not detected on host</strong>: Direct PDF downloading is disabled. 
                    You can still easily save as PDF by clicking the <strong>"Print / Save as PDF"</strong> button above and choosing <strong>"Save as PDF"</strong> in your browser's print dialog.
                  </div>
                </div>
              )}
              
              <div className="preview-iframe-wrapper">
                <iframe 
                  id="preview-iframe" 
                  className="preview-iframe"
                  srcDoc={previewHtml}
                  title="Attendance Sheet Preview"
                />
              </div>
            </div>
          </div>
        </div>
      )}
      {/* iPhone Device Token Guide Modal */}
      {isIphoneModalOpen && (
        <div className="preview-modal-backdrop" onClick={() => setIsIphoneModalOpen(false)}>
          <div className="preview-modal-container" style={{ maxWidth: '500px', height: 'auto', minHeight: '400px' }} onClick={(e) => e.stopPropagation()}>
            <div className="preview-modal-header">
              <div className="preview-modal-title">
                <Info size={20} color="var(--color-primary)" />
                <span>iPhone / iOS Device Token Guide</span>
              </div>
              <div className="preview-modal-actions">
                <button 
                  onClick={() => setIsIphoneModalOpen(false)}
                  className="btn btn-secondary"
                  style={{ padding: '0.45rem', minWidth: 'auto', minHeight: 'auto' }}
                  title="Close Guide"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            
            <div className="preview-modal-body" style={{ padding: '1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', color: 'var(--text-primary)', fontSize: '0.9rem' }}>
              {/* Browser Toggle */}
              <div style={{ display: 'flex', gap: '0.5rem', padding: '0.2rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px' }}>
                <button
                  type="button"
                  onClick={() => setGuideBrowser('chrome')}
                  style={{
                    flex: 1,
                    background: guideBrowser === 'chrome' ? 'rgba(255,255,255,0.08)' : 'transparent',
                    border: 'none',
                    color: guideBrowser === 'chrome' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    padding: '0.4rem',
                    borderRadius: '4px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Google Chrome iOS
                </button>
                <button
                  type="button"
                  onClick={() => setGuideBrowser('safari')}
                  style={{
                    flex: 1,
                    background: guideBrowser === 'safari' ? 'rgba(255,255,255,0.08)' : 'transparent',
                    border: 'none',
                    color: guideBrowser === 'safari' ? 'var(--text-primary)' : 'var(--text-secondary)',
                    padding: '0.4rem',
                    borderRadius: '4px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Safari iOS
                </button>
              </div>

              <p style={{ margin: 0 }}>
                Follow these simple steps using a <strong>{guideBrowser === 'chrome' ? 'Chrome' : 'Safari'} Bookmarklet</strong> to retrieve your token:
              </p>
              
              <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <strong style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--color-primary)' }}>Step 1: Copy this code</strong>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <textarea 
                    value={`javascript:(function(){var t=localStorage.getItem('token');if(t){alert('Your Device Token:\\n\\n'+t);console.log(t);}else{alert('Token not found. Make sure you are on ksps.co.id/eksternal/');}})();`}
                    onClick={(e) => { e.target.focus(); e.target.select(); }}
                    onChange={() => {}}
                    style={{ flex: 1, height: '60px', padding: '0.4rem', fontSize: '0.75rem', fontFamily: 'monospace', background: 'rgba(0,0,0,0.3)', color: '#a78bfa', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', resize: 'none' }}
                  />
                  <button 
                    onClick={handleCopyBookmarklet}
                    className="btn btn-primary"
                    style={{ minWidth: 'auto', padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    Copy
                  </button>
                </div>
              </div>
              
              {guideBrowser === 'chrome' ? (
                <ol style={{ paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: 0, fontSize: '0.85rem' }}>
                  <li>Bookmark any random page in Chrome on your iPhone, and name it <strong>"Get Token"</strong>.</li>
                  <li>Go to Chrome Bookmarks, click **Edit** on it, delete the URL, and paste the copied javascript code.</li>
                  <li>Open Chrome on your iPhone and go to <code>https://ksps.co.id/eksternal/absen/remote</code>.</li>
                  <li>Tap the browser address bar, type **"Get Token"** and click on the bookmark suggestion (with the star icon) that matches.</li>
                  <li>An alert will pop up showing your registered Device Token! Copy and paste it here.</li>
                </ol>
              ) : (
                <ol style={{ paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: 0, fontSize: '0.85rem' }}>
                  <li>Add a bookmark for any random page in Safari on your iPhone, and name it <strong>"Get Token"</strong>.</li>
                  <li>Edit that bookmark, delete the URL, and paste the copied javascript code from above into the URL field.</li>
                  <li>Open Safari, log into <code>https://ksps.co.id/eksternal/</code>, and load the remote page.</li>
                  <li>Tap your bookmark bar and click <strong>"Get Token"</strong>. Your registered token will pop up in an alert!</li>
                  <li>Copy the token and paste it here in the app!</li>
                </ol>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
