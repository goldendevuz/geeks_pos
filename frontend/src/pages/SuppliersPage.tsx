import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Edit, Trash2, Building2 } from 'lucide-react'

type Supplier = {
  id: string
  name: string
  contact_person: string
  phone: string
  email: string
  address: string
  created_at: string
}

export function SuppliersPage() {
  const { t } = useTranslation()
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    contact_person: '',
    phone: '',
    email: '',
    address: ''
  })

  useEffect(() => {
    loadSuppliers()
  }, [])

  const loadSuppliers = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/catalog/suppliers/')
      if (response.ok) {
        const data = await response.json()
        setSuppliers(data.results || data)
      }
    } catch (error) {
      console.error('Failed to load suppliers:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const url = editingId ? `/api/catalog/suppliers/${editingId}/` : '/api/catalog/suppliers/'
      const method = editingId ? 'PUT' : 'POST'
      
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-CSRFToken': getCsrfToken()
        },
        body: JSON.stringify(form)
      })

      if (response.ok) {
        await loadSuppliers()
        setShowForm(false)
        setEditingId(null)
        setForm({ name: '', contact_person: '', phone: '', email: '', address: '' })
      }
    } catch (error) {
      console.error('Failed to save supplier:', error)
    }
  }

  const handleEdit = (supplier: Supplier) => {
    setForm({
      name: supplier.name,
      contact_person: supplier.contact_person,
      phone: supplier.phone,
      email: supplier.email,
      address: supplier.address
    })
    setEditingId(supplier.id)
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('admin.suppliers.confirmDelete', 'Delete this supplier?'))) return
    
    try {
      const response = await fetch(`/api/catalog/suppliers/${id}/`, {
        method: 'DELETE',
        headers: {
          'X-CSRFToken': getCsrfToken()
        }
      })

      if (response.ok) {
        await loadSuppliers()
      }
    } catch (error) {
      console.error('Failed to delete supplier:', error)
    }
  }

  const getCsrfToken = () => {
    const cookies = document.cookie.split(';')
    for (let cookie of cookies) {
      const [name, value] = cookie.trim().split('=')
      if (name === 'csrftoken') return value
    }
    return ''
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center py-8">
          <div className="text-slate-400">{t('admin.common.loading')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{t('admin.sidebar.suppliers')}</h1>
          <p className="text-sm text-slate-400 mt-1">{t('admin.suppliers.hint')}</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="touch-btn flex items-center gap-2 px-4 py-2 bg-emerald-700 border border-emerald-500 rounded-xl text-white text-sm"
        >
          <Plus className="h-4 w-4" />
          {t('admin.suppliers.add', 'Add Supplier')}
        </button>
      </div>

      {showForm && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-100 mb-4">
            {editingId ? t('admin.suppliers.edit', 'Edit Supplier') : t('admin.suppliers.add', 'Add Supplier')}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <input
                type="text"
                placeholder={t('admin.suppliers.namePlaceholder')}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="touch-btn px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100"
                required
              />
              <input
                type="text"
                placeholder={t('admin.suppliers.contactPersonPlaceholder')}
                value={form.contact_person}
                onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
                className="touch-btn px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100"
              />
              <input
                type="tel"
                placeholder={t('admin.suppliers.phonePlaceholder')}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="touch-btn px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100"
              />
              <input
                type="email"
                placeholder={t('admin.suppliers.emailPlaceholder')}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="touch-btn px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100"
              />
            </div>
            <textarea
              placeholder={t('admin.suppliers.addressPlaceholder')}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="touch-btn w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-100"
              rows={3}
            />
            <div className="flex gap-2">
              <button
                type="submit"
                className="touch-btn px-4 py-2 bg-emerald-700 border border-emerald-500 rounded-xl text-white text-sm"
              >
                {t('admin.common.save')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false)
                  setEditingId(null)
                  setForm({ name: '', contact_person: '', phone: '', email: '', address: '' })
                }}
                className="touch-btn px-4 py-2 bg-slate-700 border border-slate-600 rounded-xl text-slate-300 text-sm"
              >
                {t('admin.common.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        {suppliers.length === 0 ? (
          <div className="p-8 text-center">
            <Building2 className="h-12 w-12 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400">{t('admin.suppliers.empty', 'No suppliers yet')}</p>
            <p className="text-sm text-slate-500 mt-1">
              {t('admin.suppliers.emptyHint', 'Add your first supplier to get started')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-800">
                <tr>
                  <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">
                    {t('admin.suppliers.name', 'Name')}
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">
                    {t('admin.suppliers.contactPerson', 'Contact')}
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">
                    {t('admin.suppliers.phone', 'Phone')}
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">
                    {t('admin.suppliers.email', 'Email')}
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">
                    {t('admin.common.action', 'Actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {suppliers.map((supplier) => (
                  <tr key={supplier.id} className="hover:bg-slate-800/50">
                    <td className="px-4 py-3 text-sm text-slate-100">{supplier.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-300">{supplier.contact_person}</td>
                    <td className="px-4 py-3 text-sm text-slate-300">{supplier.phone}</td>
                    <td className="px-4 py-3 text-sm text-slate-300">{supplier.email}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEdit(supplier)}
                          className="touch-btn p-2 text-blue-400 hover:bg-blue-400/10 rounded-lg"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(supplier.id)}
                          className="touch-btn p-2 text-red-400 hover:bg-red-400/10 rounded-lg"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
