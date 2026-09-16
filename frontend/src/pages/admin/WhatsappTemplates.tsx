import Swal from 'sweetalert2'
import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { whatsappTemplatesApi, type WhatsappTemplate, type WhatsappTemplateFile } from '@/lib/api'
import { toast } from 'sonner'
import {
  MessageSquare, Plus, Search, Trash2, Edit3, Paperclip, FileText,
  Check, Copy, Share2, Sparkles, X, FileCheck, Tag, Eye, Download
} from 'lucide-react'
import { cn } from '@/lib/utils'

const CATEGORIES = [
  { id: 'all', label: 'All Templates' },
  { id: 'greeting', label: 'Greeting Templates' },
  { id: 'followup', label: 'Follow-up' },
  { id: 'promotion', label: 'Promotional' },
  { id: 'general', label: 'General' },
]

const PLACEHOLDERS = [
  { tag: '{{name}}', label: 'Contact name' },
  { tag: '{{mobile}}', label: 'Phone' },
  { tag: '{{email}}', label: 'Email' },
  { tag: '{{company}}', label: 'Company' },
  { tag: '{{quote_number}}', label: 'Quote number' },
  { tag: '{{quote_link}}', label: 'Quote link' },
  { tag: '{{order_number}}', label: 'Order number' },
  { tag: '{{invoice_number}}', label: 'Invoice number' },
  { tag: '{{tracking_number}}', label: 'Tracking' },
  { tag: '{{amount_due}}', label: 'Amount due' },
  { tag: '{{product_grid}}', label: 'Product grid' },
]

export default function WhatsappTemplates() {
  const queryClient = useQueryClient()
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<WhatsappTemplate | null>(null)

  // Form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('greeting')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [existingFiles, setExistingFiles] = useState<WhatsappTemplateFile[]>([])
  const [filesToRemove, setFilesToRemove] = useState<number[]>([])
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch templates list
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['whatsapp-templates', selectedCategory, searchQuery],
    queryFn: () => whatsappTemplatesApi.list({ category: selectedCategory, search: searchQuery }),
  })

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (formData: FormData) => whatsappTemplatesApi.create(formData),
    onSuccess: () => {
      toast.success('WhatsApp template created successfully!')
      queryClient.invalidateQueries({ queryKey: ['whatsapp-templates'] })
      closeModal()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Failed to create template')
    },
  })

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, formData }: { id: number; formData: FormData }) => {
      // First delete removed existing files
      for (const fileId of filesToRemove) {
        await whatsappTemplatesApi.deleteFile(fileId)
      }
      return whatsappTemplatesApi.update(id, formData)
    },
    onSuccess: () => {
      toast.success('WhatsApp template updated successfully!')
      queryClient.invalidateQueries({ queryKey: ['whatsapp-templates'] })
      closeModal()
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Failed to update template')
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => whatsappTemplatesApi.delete(id),
    onSuccess: () => {
      Swal.fire({
        title: 'Deleted!',
        text: 'WhatsApp template has been deleted successfully.',
        icon: 'success',
        timer: 1800,
        showConfirmButton: false,
      })
      queryClient.invalidateQueries({ queryKey: ['whatsapp-templates'] })
    },
    onError: (err: any) => {
      Swal.fire({
        title: 'Error!',
        text: err.response?.data?.error || 'Failed to delete template',
        icon: 'error',
      })
    },
  })

  const openCreateModal = () => {
    setEditingTemplate(null)
    setTitle('')
    setDescription('')
    setCategory('greeting')
    setSelectedFiles([])
    setExistingFiles([])
    setFilesToRemove([])
    setIsModalOpen(true)
  }

  const openEditModal = (tpl: WhatsappTemplate) => {
    setEditingTemplate(tpl)
    setTitle(tpl.title)
    setDescription(tpl.description)
    setCategory(tpl.category || 'greeting')
    setSelectedFiles([])
    setExistingFiles(tpl.attachments || [])
    setFilesToRemove([])
    setIsModalOpen(true)
  }

  const closeModal = () => {
    setIsModalOpen(false)
    setEditingTemplate(null)
    setTitle('')
    setDescription('')
    setCategory('greeting')
    setSelectedFiles([])
    setExistingFiles([])
    setFilesToRemove([])
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const filesArr = Array.from(e.target.files)
      setSelectedFiles((prev) => [...prev, ...filesArr])
    }
  }

  const removeSelectedFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const removeExistingFile = (fileId: number, fileName: string) => {
    Swal.fire({
      title: 'Remove Attachment?',
      text: `Do you want to remove "${fileName}" from this template?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Yes, remove',
    }).then((result) => {
      if (result.isConfirmed) {
        setExistingFiles((prev) => prev.filter((f) => f.id !== fileId))
        setFilesToRemove((prev) => [...prev, fileId])
      }
    })
  }

  const handleDeleteTemplate = (tpl: WhatsappTemplate) => {
    Swal.fire({
      title: 'Are you sure?',
      text: `Do you want to delete template "${tpl.title}"? This process cannot be undone.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#6b7280',
      confirmButtonText: 'Yes, delete it!',
      cancelButtonText: 'Cancel',
      customClass: {
        popup: 'rounded-2xl font-sans',
        confirmButton: 'px-4 py-2 rounded-xl text-sm font-bold',
        cancelButton: 'px-4 py-2 rounded-xl text-sm font-semibold',
      },
    }).then((result) => {
      if (result.isConfirmed) {
        deleteMutation.mutate(tpl.id)
      }
    })
  }

  const insertPlaceholder = (tag: string) => {
    setDescription((prev) => prev + (prev.length && !prev.endsWith(' ') ? ' ' : '') + tag)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return toast.error('Template title is required')
    if (!description.trim()) return toast.error('Template description/content is required')

    const formData = new FormData()
    formData.append('title', title.trim())
    formData.append('description', description.trim())
    formData.append('category', category)

    selectedFiles.forEach((file) => {
      formData.append('files', file)
    })

    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, formData })
    } else {
      createMutation.mutate(formData)
    }
  }

  const handleCopyText = (text: string, id: number) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    toast.success('Template text copied to clipboard!')
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleShareWhatsapp = (tpl: WhatsappTemplate) => {
    const text = encodeURIComponent(tpl.description)
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank')
  }

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const isImageFile = (type: string | null, name: string) => {
    if (type?.startsWith('image/')) return true
    return /\.(jpg|jpeg|png|gif|webp)$/i.test(name)
  }

  const totalTemplatesCount = templates.length
  const greetingCount = templates.filter((t) => t.category === 'greeting').length
  const totalFilesCount = templates.reduce((acc, t) => acc + (t.attachments?.length || 0), 0)

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-800 rounded-2xl p-6 text-white shadow-xl">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="p-2 bg-white/20 backdrop-blur-md rounded-xl">
              <MessageSquare className="h-6 w-6 text-emerald-100" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight">WhatsApp Templates</h1>
          </div>
          <p className="text-emerald-100 text-sm max-w-xl">
            Create, manage, and share personalized WhatsApp greeting messages & notifications with multi-file attachments (images, PDFs, documents).
          </p>
        </div>

        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-5 py-3 bg-white text-emerald-800 hover:bg-emerald-50 rounded-xl font-bold text-sm shadow-md transition-all hover:scale-105 active:scale-95 shrink-0"
        >
          <Plus className="h-5 w-5 text-emerald-700" />
          Create Template
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border rounded-xl p-4 flex items-center gap-4 shadow-sm">
          <div className="h-12 w-12 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
            <MessageSquare className="h-6 w-6" />
          </div>
          <div>
            <div className="text-2xl font-extrabold">{totalTemplatesCount}</div>
            <div className="text-xs text-muted-foreground font-medium">Total Templates</div>
          </div>
        </div>

        <div className="bg-card border rounded-xl p-4 flex items-center gap-4 shadow-sm">
          <div className="h-12 w-12 rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400 flex items-center justify-center font-bold">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <div className="text-2xl font-extrabold">{greetingCount}</div>
            <div className="text-xs text-muted-foreground font-medium">Greeting Templates</div>
          </div>
        </div>

        <div className="bg-card border rounded-xl p-4 flex items-center gap-4 shadow-sm">
          <div className="h-12 w-12 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
            <Paperclip className="h-6 w-6" />
          </div>
          <div>
            <div className="text-2xl font-extrabold">{totalFilesCount}</div>
            <div className="text-xs text-muted-foreground font-medium">Attached Files</div>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 border-b pb-4">
        {/* Categories Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={cn(
                'px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all',
                selectedCategory === cat.id
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-muted/60 text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search Bar */}
        <div className="relative min-w-[240px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-background border rounded-lg text-xs focus:ring-2 focus:ring-emerald-500 outline-none"
          />
        </div>
      </div>

      {/* Templates Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-64 rounded-2xl border bg-card/40 animate-pulse p-6 space-y-4">
              <div className="h-6 bg-muted rounded w-3/4" />
              <div className="h-20 bg-muted/60 rounded" />
              <div className="h-10 bg-muted/40 rounded" />
            </div>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="bg-card border border-dashed rounded-2xl p-12 text-center space-y-4">
          <div className="h-16 w-16 bg-emerald-500/10 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
            <MessageSquare className="h-8 w-8" />
          </div>
          <div>
            <h3 className="text-lg font-bold">No WhatsApp Templates Found</h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1">
              Create greeting templates with custom title, description, and attached images/PDFs for seamless customer outreach.
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow transition-all"
          >
            <Plus className="h-4 w-4" />
            Create First Template
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              className="group bg-card border hover:border-emerald-500/40 rounded-2xl p-5 shadow-sm hover:shadow-lg transition-all flex flex-col justify-between"
            >
              <div className="space-y-4">
                {/* Header: Title & Category */}
                <div className="flex items-start justify-between gap-2 border-b pb-3">
                  <div>
                    <h3 className="font-bold text-base text-foreground group-hover:text-emerald-600 transition-colors line-clamp-1">
                      {tpl.title}
                    </h3>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1">
                      <span>Created by {tpl.user?.name || 'Admin'}</span>
                      <span>&bull;</span>
                      <span>{new Date(tpl.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <span className="px-2.5 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 shrink-0">
                    {tpl.category}
                  </span>
                </div>

                {/* Description Body */}
                <div className="bg-emerald-500/5 dark:bg-emerald-950/20 border border-emerald-500/10 rounded-xl p-3.5 relative text-xs leading-relaxed text-foreground whitespace-pre-wrap font-sans max-h-40 overflow-y-auto custom-scrollbar">
                  {tpl.description}
                </div>

                {/* Attachments Section */}
                {tpl.attachments && tpl.attachments.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
                      <Paperclip className="h-3.5 w-3.5 text-emerald-600" />
                      <span>Attachments ({tpl.attachments.length})</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {tpl.attachments.map((file) => (
                        <div
                          key={file.id}
                          className="flex items-center gap-2 p-2 rounded-lg border bg-muted/30 hover:bg-accent/50 transition-colors text-[11px] group/file relative overflow-hidden"
                        >
                          {isImageFile(file.fileType, file.fileName) ? (
                            <button
                              type="button"
                              onClick={() => setPreviewImage(file.filePath)}
                              className="h-8 w-8 rounded bg-cover bg-center shrink-0 border relative hover:opacity-80"
                              style={{ backgroundImage: `url(${file.filePath})` }}
                            >
                              <div className="absolute inset-0 bg-black/30 opacity-0 hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                                <Eye className="h-3 w-3" />
                              </div>
                            </button>
                          ) : (
                            <div className="h-8 w-8 rounded bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
                              <FileText className="h-4 w-4" />
                            </div>
                          )}

                          <div className="flex-1 min-w-0">
                            <p className="truncate font-medium text-foreground text-[10px]" title={file.fileName}>
                              {file.fileName}
                            </p>
                            <p className="text-[9px] text-muted-foreground">
                              {formatFileSize(file.fileSize)}
                            </p>
                          </div>

                          <a
                            href={file.filePath}
                            target="_blank"
                            rel="noopener noreferrer"
                            download
                            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-background transition-colors"
                            title="Download file"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between border-t pt-4 mt-5">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleCopyText(tpl.description, tpl.id)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold hover:bg-accent transition-colors"
                    title="Copy message text"
                  >
                    {copiedId === tpl.id ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="text-emerald-600">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleShareWhatsapp(tpl)}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors shadow-sm"
                    title="Open in WhatsApp"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    <span>Send</span>
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEditModal(tpl)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    title="Edit template"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>

                  <button
                    onClick={() => handleDeleteTemplate(tpl)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 transition-colors"
                    title="Delete template"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Dialog: Create / Edit Template */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/20">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-500/15 text-emerald-600 rounded-lg">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="font-bold text-base">
                    {editingTemplate ? 'Edit WhatsApp Template' : 'Create WhatsApp Template'}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    Set title, greeting content, placeholders, and attach JPG/PDF files.
                  </p>
                </div>
              </div>

              <button
                onClick={closeModal}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body Form */}
            <form onSubmit={handleSubmit} className="p-6 overflow-y-auto custom-scrollbar space-y-5 flex-1">
              {/* Title & Category */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-xs font-bold text-foreground flex items-center gap-1">
                    <span>Title</span>
                    <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Welcome Greeting Template"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-3.5 py-2 border rounded-xl bg-background text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-foreground">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 border rounded-xl bg-background text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  >
                    <option value="greeting">Greeting</option>
                    <option value="followup">Follow-up</option>
                    <option value="promotion">Promotional</option>
                    <option value="general">General</option>
                  </select>
                </div>
              </div>

              {/* Description Body */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground flex items-center gap-1">
                    <span>Description / Message Body</span>
                    <span className="text-rose-500">*</span>
                  </label>
                  <span className="text-[10px] text-muted-foreground">Click tags below to insert</span>
                </div>

                {/* Quick Insert Placeholders */}
                <div className="flex flex-wrap items-center gap-1.5 pb-1">
                  {PLACEHOLDERS.map((p) => (
                    <button
                      key={p.tag}
                      type="button"
                      onClick={() => insertPlaceholder(p.tag)}
                      className="px-2 py-1 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-mono font-bold transition-colors flex items-center gap-1 border border-emerald-500/20"
                    >
                      <Tag className="h-2.5 w-2.5" />
                      <span>{p.tag}</span>
                    </button>
                  ))}
                </div>

                <textarea
                  rows={5}
                  placeholder="Enter greeting text message... e.g. Dear {{name}}, thank you for reaching out!"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full p-3.5 border rounded-xl bg-background text-sm focus:ring-2 focus:ring-emerald-500 outline-none font-sans leading-relaxed"
                  required
                />
              </div>

              {/* Multi-File Upload Section */}
              <div className="space-y-3 pt-1">
                <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Paperclip className="h-4 w-4 text-emerald-600" />
                  <span>Attach Files (JPG, PNG, PDF, DOC, XLSX)</span>
                </label>

                {/* Dropzone */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-emerald-500/30 hover:border-emerald-500/60 bg-emerald-500/5 rounded-2xl p-6 text-center cursor-pointer transition-all hover:scale-[1.005]"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <div className="h-10 w-10 bg-emerald-500/10 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-2">
                    <Paperclip className="h-5 w-5" />
                  </div>
                  <p className="text-xs font-bold text-foreground">
                    Click to browse or drag & drop files here
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Supports multiple JPG, PNG, WEBP images and PDF / DOC files (up to 10MB each)
                  </p>
                </div>

                {/* Combined Attached Files List */}
                {(existingFiles.length > 0 || selectedFiles.length > 0) && (
                  <div className="space-y-2 pt-2">
                    <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                      Attached ({existingFiles.length + selectedFiles.length})
                    </p>

                    <div className="space-y-1.5 max-h-44 overflow-y-auto custom-scrollbar">
                      {/* Existing Files */}
                      {existingFiles.map((file) => (
                        <div
                          key={file.id}
                          className="flex items-center justify-between p-2.5 rounded-xl border bg-card text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {isImageFile(file.fileType, file.fileName) ? (
                              <div
                                className="h-8 w-8 rounded bg-cover bg-center shrink-0 border"
                                style={{ backgroundImage: `url(${file.filePath})` }}
                              />
                            ) : (
                              <div className="h-8 w-8 rounded bg-emerald-500/10 text-emerald-600 flex items-center justify-center shrink-0">
                                <FileText className="h-4 w-4" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="truncate font-medium text-foreground text-xs">{file.fileName}</p>
                              <span className="text-[10px] text-muted-foreground">Existing file</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => removeExistingFile(file.id, file.fileName)}
                            className="p-1 rounded text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 transition-colors"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}

                      {/* Newly Selected Files */}
                      {selectedFiles.map((file, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="h-8 w-8 rounded bg-emerald-500/15 text-emerald-600 flex items-center justify-center shrink-0 font-bold">
                              <FileCheck className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-foreground text-xs">{file.name}</p>
                              <span className="text-[10px] text-emerald-600 font-semibold">
                                New upload &bull; {formatFileSize(file.size)}
                              </span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => removeSelectedFile(idx)}
                            className="p-1 rounded text-muted-foreground hover:text-rose-600 hover:bg-rose-500/10 transition-colors"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer Actions */}
              <div className="flex items-center justify-end gap-2 border-t pt-4 mt-6">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 rounded-xl border text-xs font-semibold hover:bg-accent transition-colors"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md transition-all disabled:opacity-50"
                >
                  {createMutation.isPending || updateMutation.isPending ? (
                    <span>Saving...</span>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      <span>{editingTemplate ? 'Update Template' : 'Save Template'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 cursor-pointer"
        >
          <div className="relative max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl">
            <img src={previewImage} alt="Attachment preview" className="object-contain max-h-[85vh] rounded-2xl" />
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-3 right-3 p-2 bg-black/60 text-white rounded-full hover:bg-black transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
