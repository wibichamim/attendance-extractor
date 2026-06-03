import React, { useState, useEffect } from 'react'
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
  Eye
} from 'lucide-react'

// Regular expression to validate HH:MM time format
const TIME_REGEX = /^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$/

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

  // Template states
  const [templateStatus, setTemplateStatus] = useState({
    is_custom: false,
    active_template: 'template_absen.xlsx',
    available_templates: []
  })
  const [isUploadingTemplate, setIsUploadingTemplate] = useState(false)

  // Preview & PDF states
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')
  const [pdfSupported, setPdfSupported] = useState(false)
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false)
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false)

  // Load session cookies from localStorage on boot
  useEffect(() => {
    const storedCookie = localStorage.getItem('absen_session_cookie')
    const storedName = localStorage.getItem('absen_user_name')
    if (storedCookie) {
      setSessionCookie(storedCookie)
    }
    if (storedName) {
      setUserDisplayName(storedName)
    }
  }, [])

  const fetchTemplateStatus = async () => {
    try {
      const res = await fetch('/api/template-status')
      if (res.ok) {
        const data = await res.json()
        setTemplateStatus(data)
      }
    } catch (err) {
      console.error('Failed to fetch template status:', err)
    }
  }

  // Load template status on mount
  useEffect(() => {
    fetchTemplateStatus()
  }, [])

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
      
      // Auto-change to holiday if it is a weekend and has no attendance data
      const isHoliday = r.is_holiday_or_leave || (isWknd && !r.has_attendance)
      let keterangan = r.keterangan
      if (isWknd && !r.has_attendance && !keterangan) {
        keterangan = dayOfWeek === 6 ? 'LIBUR - SABTU' : 'LIBUR - MINGGU'
      }

      return {
        ...r,
        keterangan: keterangan,
        rowType: isHoliday ? 'holiday' : 'normal',
        is_holiday_or_leave: isHoliday,
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
      
      localStorage.setItem('absen_session_cookie', data.session_cookie)
      localStorage.setItem('absen_user_name', data.display_name)
      
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
    localStorage.removeItem('absen_session_cookie')
    localStorage.removeItem('absen_user_name')
    addToast('info', 'Logged out. Session cookies cleared.')
  }

  // Action: Download current template
  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch('/api/download-template')
      if (!response.ok) throw new Error('Failed to download template')
      
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = templateStatus.active_template || 'template_absen.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      addToast('success', 'Excel template downloaded successfully.')
    } catch (err) {
      console.error(err)
      addToast('error', `Download failed: ${err.message}`)
    }
  }

  // Action: Upload custom template
  const handleUploadTemplate = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    
    if (!file.name.endsWith('.xlsx')) {
      addToast('error', 'Only .xlsx files are supported.')
      return
    }
    
    setIsUploadingTemplate(true)
    const formData = new FormData()
    formData.append('file', file)
    
    try {
      const res = await fetch('/api/upload-template', {
        method: 'POST',
        body: formData
      })
      
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      
      addToast('success', 'Custom template uploaded successfully!')
      fetchTemplateStatus()
    } catch (err) {
      console.error(err)
      addToast('error', `Upload failed: ${err.message}`)
    } finally {
      setIsUploadingTemplate(false)
      // Reset input value
      e.target.value = ''
    }
  }

  // Action: Reset custom template to default
  const handleResetTemplate = async () => {
    try {
      const res = await fetch('/api/reset-template', {
        method: 'POST'
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Reset failed')
      
      addToast('success', 'Reverted to default template.')
      fetchTemplateStatus()
    } catch (err) {
      console.error(err)
      addToast('error', `Reset failed: ${err.message}`)
    }
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

  const handleCellChange = (index, field, value) => {
    const updated = [...tableData]
    const row = updated[index]
    row[field] = value === '' ? null : value
    
    // Perform validations
    if (field === 'masuk') {
      row.masukInvalid = value !== '' && value !== '-' && !TIME_REGEX.test(value)
      row.has_attendance = (row.masuk !== null && row.masuk !== '') || (row.pulang !== null && row.pulang !== '')
    }
    if (field === 'pulang') {
      row.pulangInvalid = value !== '' && value !== '-' && !TIME_REGEX.test(value)
      row.has_attendance = (row.masuk !== null && row.masuk !== '') || (row.pulang !== null && row.pulang !== '')
    }
    if (field === 'keterangan') {
      row.is_holiday_or_leave = value !== null && value !== ''
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
        
        <div className="server-status">
          <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}></div>
          <span>{isConnected ? 'Backend Connected' : 'Connecting Backend...'}</span>
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
                  title="Download template_absen.xlsx"
                >
                  <Download size={14} />
                  Download template_absen.xlsx
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
            
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button 
                onClick={handleShowPreview}
                className="btn btn-secondary"
                disabled={isLoading || isGeneratingPreview}
              >
                {isGeneratingPreview ? <RefreshCw className="spinner" size={16} /> : <Eye size={16} />}
                Show Preview & PDF
              </button>
              <button 
                onClick={handleGenerateXLSX}
                className="btn btn-success"
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
                  <th style={{ width: '60px', textAlign: 'center' }}>Day</th>
                  <th style={{ width: '130px' }}>Weekday</th>
                  <th style={{ width: '150px' }}>Row Type</th>
                  <th style={{ width: '150px', textAlign: 'center' }}>Check-in (Masuk)</th>
                  <th style={{ width: '150px', textAlign: 'center' }}>Check-out (Pulang)</th>
                  <th>Holiday / Weekend Remark (Keterangan)</th>
                </tr>
              </thead>
              <tbody>
                {tableData.map((row, idx) => {
                  const weekend = isWeekend(row.tgl)
                  const weekdayName = getWeekdayName(row.tgl)
                  
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
                            <input 
                              type="text" 
                              value={row.masuk || ''} 
                              onChange={(e) => handleCellChange(idx, 'masuk', e.target.value)}
                              placeholder="HH:MM"
                              className={`cell-input ${row.masukInvalid ? 'invalid' : ''}`}
                              title="Time must be in 24h format (HH:MM) or empty / '-'"
                            />
                            {row.masukInvalid && (
                              <div style={{ color: 'var(--color-danger)', fontSize: '0.7rem', marginTop: '0.15rem', textAlign: 'center' }}>
                                Invalid HH:MM
                              </div>
                            )}
                          </td>
                          <td>
                            <input 
                              type="text" 
                              value={row.pulang || ''} 
                              onChange={(e) => handleCellChange(idx, 'pulang', e.target.value)}
                              placeholder="HH:MM"
                              className={`cell-input ${row.pulangInvalid ? 'invalid' : ''}`}
                              title="Time must be in 24h format (HH:MM) or empty / '-'"
                            />
                            {row.pulangInvalid && (
                              <div style={{ color: 'var(--color-danger)', fontSize: '0.7rem', marginTop: '0.15rem', textAlign: 'center' }}>
                                Invalid HH:MM
                              </div>
                            )}
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

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '0.5rem' }}>
            <button 
              onClick={handleShowPreview}
              className="btn btn-secondary"
              disabled={isLoading || isGeneratingPreview}
              style={{ padding: '0.8rem 1.5rem', fontSize: '1rem' }}
            >
              {isGeneratingPreview ? <RefreshCw className="spinner" size={18} /> : <Eye size={18} />}
              Show Preview & PDF
            </button>
            <button 
              onClick={handleGenerateXLSX}
              className="btn btn-success"
              disabled={isLoading}
              style={{ padding: '0.8rem 2rem', fontSize: '1rem' }}
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
                  className="btn btn-secondary"
                  style={{ padding: '0.45rem 1rem', fontSize: '0.85rem', minHeight: 'auto' }}
                >
                  <Printer size={15} />
                  Print / Save as PDF
                </button>
                <button 
                  onClick={handleDownloadPDF}
                  className="btn btn-primary"
                  style={{ padding: '0.45rem 1rem', fontSize: '0.85rem', minHeight: 'auto' }}
                  disabled={isGeneratingPdf}
                >
                  {isGeneratingPdf ? <RefreshCw className="spinner" size={15} /> : <Download size={15} />}
                  {pdfSupported ? 'Download PDF' : 'Download PDF (Requires LibreOffice)'}
                </button>
                <button 
                  onClick={() => setIsPreviewOpen(false)}
                  className="btn btn-secondary"
                  style={{ padding: '0.45rem', minWidth: 'auto', minHeight: 'auto' }}
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
    </div>
  )
}
