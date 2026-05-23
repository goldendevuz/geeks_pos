import { useEffect, useMemo, useState } from 'react'
import { Building2, HardDriveDownload, Printer, ScanLine, ShieldCheck, Bot, Cog } from 'lucide-react'
import {
  activateLicense,
  fetchLicenseStatus,
  fetchPinUsers,
  setUserPin,
  testLabelPrintPayload,
  testReceiptPrintPayload,
  type IntegrationSettings,
  type LicenseStatus,
  type PinUser,
  type StocktakeSession,
  type StoreSettings,
} from '../api'
import { useTranslation } from 'react-i18next'
import { labelPrinterStatus, receiptPrinterStatus } from '../utils/hardwareStatus'
import { printRawBase64 } from '../utils/tauriPrint'
import { ActionToast } from '../components/ActionToast'
import { getTauriMachineId } from '../utils/tauriMachineId'

export function SettingsPage({
  settings,
  integrations,
  onSave,
  onSaveIntegrations,
  onSendZReport,
  stocktake,
  onCreateStocktake,
  onSetCount,
  onApplyStocktake,
  onReloadOpen,
  onBackupNow,
  canManageInventory,
}: {
  settings: StoreSettings | null
  integrations: IntegrationSettings | null
  onSave: (data: {
    brand_name: string
    phone: string
    address: string
    footer_note: string
    transliterate_uz: boolean
    receipt_printer_name: string
    receipt_printer_type: 'ESC_POS' | 'TSPL'
    receipt_printer_port?: string
    label_printer_name: string
    label_printer_type: 'ESC_POS' | 'TSPL'
    label_printer_port?: string
    receipt_lang?: string
    receipt_width: '58mm' | '80mm'
    auto_print_on_sale: boolean
    scanner_mode: 'keyboard' | 'serial'
    scanner_prefix: string
    scanner_suffix: string
    lock_timeout_minutes?: number
    low_stock_threshold?: number
    show_price_on_labels_default?: boolean
    show_selling_price_in_catalog?: boolean
    logo?: File | null
  }) => Promise<void>
  onSaveIntegrations: (data: IntegrationSettings) => Promise<void>
  onSendZReport: () => Promise<unknown>
  stocktake: StocktakeSession | null
  onCreateStocktake: (note: string) => Promise<void>
  onSetCount: (variantId: string, countedQty: number) => Promise<void>
  onApplyStocktake: () => Promise<void>
  onReloadOpen: () => Promise<void>
  onBackupNow: () => Promise<{ ok: boolean; backup_path: string }>
  canManageInventory: boolean
}) {
  const { t, i18n } = useTranslation()
  const [activeTab, setActiveTab] = useState<'store' | 'bots' | 'security'>('store')
  const [actionToast, setActionToast] = useState<{
    kind: 'ok' | 'err'
    message: string
  } | null>(null)
  const [logo, setLogo] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [stocktakeBusy, setStocktakeBusy] = useState(false)
  const [stocktakeNote, setStocktakeNote] = useState('')
  const [countByVariant, setCountByVariant] = useState<Record<string, string>>({})
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [form, setForm] = useState({
    brand_name: settings?.brand_name ?? '',
    phone: settings?.phone ?? '',
    address: settings?.address ?? '',
    footer_note: settings?.footer_note ?? '',
    transliterate_uz: settings?.transliterate_uz ?? true,
    receipt_lang: settings?.receipt_lang ?? '',
    receipt_printer_name: settings?.receipt_printer_name ?? '',
    receipt_printer_type: settings?.receipt_printer_type ?? 'ESC_POS',
    receipt_printer_port: settings?.receipt_printer_port ?? '',
    label_printer_name: settings?.label_printer_name ?? '',
    label_printer_type: settings?.label_printer_type ?? 'TSPL',
    label_printer_port: settings?.label_printer_port ?? '',
    receipt_width: settings?.receipt_width ?? '58mm',
    auto_print_on_sale: settings?.auto_print_on_sale ?? true,
    scanner_mode: settings?.scanner_mode ?? 'keyboard',
    scanner_prefix: settings?.scanner_prefix ?? '',
    scanner_suffix: settings?.scanner_suffix ?? '\t',
    lock_timeout_minutes: settings?.lock_timeout_minutes ?? 5,
    low_stock_threshold: settings?.low_stock_threshold ?? 3,
    show_price_on_labels_default: settings?.show_price_on_labels_default ?? true,
    show_selling_price_in_catalog: settings?.show_selling_price_in_catalog ?? false,
  })
  const [pinUsers, setPinUsers] = useState<PinUser[]>([])
  const [pinDrafts, setPinDrafts] = useState<Record<string, string>>({})
  const [printerOptions, setPrinterOptions] = useState<string[]>([])
  const [scannerTest, setScannerTest] = useState('')
  const [scannerTestOk, setScannerTestOk] = useState(false)
  const [hwStep, setHwStep] = useState<1 | 2 | 3>(1)
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null)
  const [hardwareId, setHardwareId] = useState('')
  const [activationKey, setActivationKey] = useState('')
  const [licenseBusy, setLicenseBusy] = useState(false)
  const [integrationForm, setIntegrationForm] = useState<IntegrationSettings>({
    telegram_bot_token: integrations?.telegram_bot_token ?? '',
    telegram_chat_id: integrations?.telegram_chat_id ?? '',
    whatsapp_provider: integrations?.whatsapp_provider ?? 'GREEN_API',
    whatsapp_api_base: integrations?.whatsapp_api_base ?? '',
    whatsapp_api_token: integrations?.whatsapp_api_token ?? '',
    whatsapp_sender: integrations?.whatsapp_sender ?? '',
    greenapi_instance_id: integrations?.greenapi_instance_id ?? '',
    greenapi_api_token_instance: integrations?.greenapi_api_token_instance ?? '',
    primary_report_channel: integrations?.primary_report_channel ?? 'both',
  })

  useEffect(() => {
    setForm({
      brand_name: settings?.brand_name ?? '',
      phone: settings?.phone ?? '',
      address: settings?.address ?? '',
      footer_note: settings?.footer_note ?? '',
      transliterate_uz: settings?.transliterate_uz ?? true,
      receipt_lang: settings?.receipt_lang ?? '',
      receipt_printer_name: settings?.receipt_printer_name ?? '',
      receipt_printer_type: settings?.receipt_printer_type ?? 'ESC_POS',
      receipt_printer_port: settings?.receipt_printer_port ?? '',
      label_printer_name: settings?.label_printer_name ?? '',
      label_printer_type: settings?.label_printer_type ?? 'TSPL',
      label_printer_port: settings?.label_printer_port ?? '',
      receipt_width: settings?.receipt_width ?? '58mm',
      auto_print_on_sale: settings?.auto_print_on_sale ?? true,
      scanner_mode: settings?.scanner_mode ?? 'keyboard',
      scanner_prefix: settings?.scanner_prefix ?? '',
      scanner_suffix: settings?.scanner_suffix ?? '\t',
      lock_timeout_minutes: settings?.lock_timeout_minutes ?? 5,
      low_stock_threshold: settings?.low_stock_threshold ?? 3,
      show_price_on_labels_default: settings?.show_price_on_labels_default ?? true,
      show_selling_price_in_catalog: settings?.show_selling_price_in_catalog ?? false,
    })
  }, [settings])

  useEffect(() => {
    void (async () => {
      try {
        setPinUsers(await fetchPinUsers())
      } catch {
        setPinUsers([])
      }
    })()
  }, [])

  useEffect(() => {
    ;(async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/tauri')
        const names = await invoke<string[]>('list_printers')
        if (Array.isArray(names)) setPrinterOptions(names)
      } catch {
        setPrinterOptions([])
      }
    })()
  }, [])

  useEffect(() => {
    setIntegrationForm({
      telegram_bot_token: integrations?.telegram_bot_token ?? '',
      telegram_chat_id: integrations?.telegram_chat_id ?? '',
      whatsapp_provider: integrations?.whatsapp_provider ?? 'GREEN_API',
      whatsapp_api_base: integrations?.whatsapp_api_base ?? '',
      whatsapp_api_token: integrations?.whatsapp_api_token ?? '',
      whatsapp_sender: integrations?.whatsapp_sender ?? '',
      greenapi_instance_id: integrations?.greenapi_instance_id ?? '',
      greenapi_api_token_instance: integrations?.greenapi_api_token_instance ?? '',
      primary_report_channel: integrations?.primary_report_channel ?? 'both',
    })
  }, [integrations])

  useEffect(() => {
    void (async () => {
      const machineId = (await getTauriMachineId()) || ''
      setHardwareId(machineId)
      try {
        setLicenseStatus(await fetchLicenseStatus())
      } catch {
        setLicenseStatus(null)
      }
    })()
  }, [])

  const receiptHw = useMemo(
    () => receiptPrinterStatus(printerOptions, form.receipt_printer_name),
    [printerOptions, form.receipt_printer_name],
  )
  const labelHw = useMemo(
    () => labelPrinterStatus(printerOptions, form.label_printer_name),
    [printerOptions, form.label_printer_name],
  )

  const hardwareAlert =
    receiptHw === 'missing' || labelHw === 'missing'
      ? 'err'
      : receiptHw === 'no_device_list' || labelHw === 'no_device_list'
        ? 'warn'
        : 'ok'

  const inputCls = 'touch-btn w-full min-h-14 px-4 rounded-xl bg-slate-900 border border-slate-700 text-base'
  const inputSoftCls =
    'touch-btn w-full min-h-14 px-4 rounded-xl bg-slate-950 border border-slate-700 text-base'
  const sectionCardCls = 'rounded-2xl border border-slate-700 bg-slate-900/70 p-4 md:p-5 space-y-3'

  if (!settings && !integrations) {
    return <div className="p-4">{t('admin.common.loading')}</div>
  }

  async function runAction(label: string, fn: () => Promise<unknown>) {
    try {
      await fn()
      setActionToast({ kind: 'ok', message: t('admin.settings.actionCompleted', { label }) })
    } catch (e: unknown) {
      const rawMessage = e instanceof Error ? e.message : String(e || '')
      if (rawMessage.startsWith('Printer ulanmagan:')) {
        setActionToast({ kind: 'err', message: rawMessage })
        return
      }
      const code = (e as Error & { code?: string }).code
      const message = t(`err.${code || 'UNKNOWN'}`, {
        defaultValue: t('admin.settings.actionFailed', { label }),
      })
      setActionToast({ kind: 'err', message })
    }
  }

  function shortBackupName(path: string): string {
    const p = (path || '').trim()
    if (!p) return ''
    const chunks = p.split(/[/\\]/)
    return chunks[chunks.length - 1] || p
  }

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{t('admin.settings.title')}</h2>
        <p className="text-xs text-slate-400">
          {t('admin.settings.headerHint')}
        </p>
      </div>
      <div className="inline-flex flex-wrap rounded-xl border border-slate-700 overflow-hidden">
        <button
          type="button"
          className={`touch-btn min-h-12 px-5 py-3 text-sm inline-flex items-center gap-2 ${activeTab === 'store' ? 'bg-emerald-700' : 'bg-slate-900'}`}
          onClick={() => setActiveTab('store')}
        >
          <Building2 className="h-4 w-4" />
          {t('admin.settings.tabStore')}
        </button>
        <button
          type="button"
          className={`touch-btn min-h-12 px-5 py-3 text-sm inline-flex items-center gap-2 ${activeTab === 'bots' ? 'bg-emerald-700' : 'bg-slate-900'}`}
          onClick={() => setActiveTab('bots')}
        >
          <Bot className="h-4 w-4" />
          {t('admin.settings.tabBots')}
        </button>
        <button
          type="button"
          className={`touch-btn min-h-12 px-5 py-3 text-sm inline-flex items-center gap-2 ${activeTab === 'security' ? 'bg-emerald-700' : 'bg-slate-900'}`}
          onClick={() => setActiveTab('security')}
        >
          <ShieldCheck className="h-4 w-4" />
          {t('admin.settings.tabSecurity', { defaultValue: 'Security' })}
        </button>
      </div>
      {actionToast && (
        <ActionToast kind={actionToast.kind} message={actionToast.message} onClose={() => setActionToast(null)} />
      )}
      {activeTab === 'store' && (
        <>
          <div> 
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 inline-flex items-center gap-2 text-slate-200">
            <Building2 className="h-5 w-5 text-emerald-400" />
            <span className="font-medium">{t('admin.settings.tabStore')}</span>
          </div>
          </div>
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault()
              setBusy(true)
              try {
                await onSave({ ...form, logo })
                setActionToast({ kind: 'ok', message: t('admin.settings.savedToast') })
              } catch (e: unknown) {
                const code = (e as Error & { code?: string }).code
                const message = t(`err.${code || 'UNKNOWN'}`, {
                  defaultValue: t('admin.settings.actionFailed', { label: t('admin.settings.saveSettings') }),
                })
                setActionToast({ kind: 'err', message })
              } finally {
                setBusy(false)
              }
            }}
          >
            <div className="grid gap-4 xl:grid-cols-3 items-start">
              <div className="space-y-4 xl:col-span-2">
              <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-xs text-slate-400">
                {t('admin.settings.headerHint')}
              </div>
            <div className={sectionCardCls}>
              <div className="inline-flex items-center gap-2 text-slate-200">
                <Cog className="h-4 w-4 text-emerald-400" />
                <h3 className="font-medium">{t('admin.settings.saveSettings')}</h3>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs text-slate-400">{t('admin.settings.brandName')}</label>
                  <input
                    className={inputCls}
                    value={form.brand_name}
                    onChange={(e) => setForm({ ...form, brand_name: e.target.value })}
                    placeholder={t('admin.settings.brandNameExample')}
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs text-slate-400">{t('admin.settings.phone')}</label>
                  <input
                    className={inputCls}
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder={t('admin.settings.phoneExample')}
                  />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <label className="block text-xs text-slate-400">{t('admin.settings.address')}</label>
                  <input
                    className={inputCls}
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder={t('admin.settings.addressExample')}
                  />
                </div>
                <div className="md:col-span-2 space-y-2">
                  <label className="block text-xs text-slate-400">{t('admin.settings.logoHint')}</label>
                  <div className="rounded-2xl border border-slate-700 bg-slate-950/50 p-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      {settings?.logo_url && !logo ? (
                        <img
                          src={settings.logo_url}
                          alt="logo"
                          className="h-20 w-20 object-contain bg-white p-2 rounded-xl border border-slate-700"
                        />
                      ) : (
                        <div className="h-20 w-20 rounded-xl border border-dashed border-slate-600 bg-slate-900 grid place-items-center text-[10px] text-slate-500">
                          LOGO
                        </div>
                      )}
                      <div className="flex-1 min-w-[220px] space-y-2">
                        <p className="text-xs text-slate-400">
                          {logo?.name || t('admin.settings.logoHint')}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <label className="touch-btn min-h-12 px-4 rounded-xl bg-slate-800 border border-slate-600 cursor-pointer inline-flex items-center">
                            {logo
                              ? t('admin.common.change', { defaultValue: 'Change' })
                              : t('admin.common.upload', { defaultValue: 'Upload logo' })}
                            <input
                              className="hidden"
                              type="file"
                              accept="image/*"
                              onChange={(e) => setLogo(e.target.files?.[0] ?? null)}
                            />
                          </label>
                          {logo && (
                            <button
                              type="button"
                              className="touch-btn min-h-12 px-4 rounded-xl bg-slate-900 border border-slate-700"
                              onClick={() => setLogo(null)}
                            >
                              {t('admin.common.remove', { defaultValue: 'Remove' })}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="md:col-span-2 space-y-1">
                  <label className="block text-xs text-slate-400">{t('admin.settings.footer')}</label>
                  <input
                    className={inputCls}
                    value={form.footer_note}
                    onChange={(e) => setForm({ ...form, footer_note: e.target.value })}
                    placeholder={t('admin.settings.footerExample')}
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs text-slate-400">
                    {t('admin.settings.receiptLanguage')}
                  </label>
                  <select
                    className={inputCls}
                    value={form.receipt_lang || ''}
                    onChange={(e) => setForm({ ...form, receipt_lang: e.target.value })}
                  >
                    <option value="">{t('admin.settings.receiptLanguageAuto')}</option>
                    <option value="uz">{t('admin.settings.receiptLangUz')}</option>
                    <option value="ru">{t('admin.settings.receiptLangRu')}</option>
                    <option value="ky">{t('admin.settings.receiptLangKy')}</option>
                  </select>
                </div>
              </div>
            </div>
            <div
              className={`rounded-xl border p-3 text-sm ${
                hardwareAlert === 'err'
                  ? 'border-red-600 bg-red-950/40 text-red-100'
                  : hardwareAlert === 'warn'
                    ? 'border-amber-600 bg-amber-950/30 text-amber-100'
                    : 'border-emerald-800 bg-emerald-950/20 text-emerald-100'
              }`}
            >
              <div className="font-medium text-base inline-flex items-center gap-2">
                <Printer className="h-4 w-4" />
                {t('admin.settings.printersTitle')}
              </div>
              <ul className="mt-2 list-disc list-inside text-xs space-y-1 opacity-95">
                <li>
                  {receiptHw === 'ok' && t('admin.settings.statusReceiptOk')}
                  {receiptHw === 'default_printer' && t('admin.settings.statusReceiptDefault')}
                  {receiptHw === 'missing' && t('admin.settings.statusReceiptMissing')}
                  {receiptHw === 'no_device_list' && t('admin.settings.statusReceiptNoList')}
                </li>
                <li>
                  {labelHw === 'ok' && t('admin.settings.statusLabelOk')}
                  {labelHw === 'default_printer' && t('admin.settings.statusLabelDefault')}
                  {labelHw === 'missing' && t('admin.settings.statusLabelMissing')}
                  {labelHw === 'no_device_list' && t('admin.settings.statusLabelNoList')}
                </li>
              </ul>
            </div>

            <div className={sectionCardCls}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h3 className="font-semibold text-slate-100 inline-flex items-center gap-2">
                  <ScanLine className="h-4 w-4" />
                  {t('admin.settings.hwWizard.title')}
                </h3>
                <div className="flex gap-1">
                  {[1, 2, 3].map((s) => (
                    <div
                      key={s}
                      className={`h-2 w-8 rounded-full ${hwStep >= s ? 'bg-emerald-500' : 'bg-slate-700'}`}
                    />
                  ))}
                </div>
              </div>
              <p className="text-xs text-slate-500">{t('admin.settings.hwWizard.doneHint')}</p>
              <datalist id="printer-options">
                {printerOptions.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>

              {hwStep === 1 && (
                <div className="space-y-3">
                  <div className="text-slate-300">{t('admin.settings.hwWizard.step1')}</div>
                  <label className="block text-xs text-slate-400">{t('admin.settings.receiptPrinterName')}</label>
                  <input
                    list="printer-options"
                    className={inputSoftCls}
                    value={form.receipt_printer_name}
                    onChange={(e) => setForm({ ...form, receipt_printer_name: e.target.value })}
                    placeholder={t('admin.settings.printerNameExample')}
                  />
                  <label className="block text-xs text-slate-400">
                    {t('admin.settings.printerPortLabel', { defaultValue: 'Receipt port (e.g. USB001)' })}
                  </label>
                  <input
                    className={inputSoftCls}
                    value={form.receipt_printer_port || ''}
                    onChange={(e) => setForm({ ...form, receipt_printer_port: e.target.value })}
                    placeholder="USB001"
                  />
                  <p className="text-xs text-slate-500">{t('admin.settings.printerNameHelp')}</p>
                  <select
                    className={inputSoftCls}
                    value={form.receipt_printer_type}
                    onChange={(e) =>
                      setForm({ ...form, receipt_printer_type: e.target.value as 'ESC_POS' | 'TSPL' })
                    }
                  >
                    <option value="ESC_POS">ESC/POS</option>
                    <option value="TSPL">TSPL</option>
                  </select>
                  <button
                    type="button"
                    className="touch-btn min-h-12 px-5 rounded-xl bg-slate-800 border border-slate-600"
                    onClick={async () => {
                      try {
                        const out = await testReceiptPrintPayload()
                        // Settings wizard test should go to the explicitly selected printer.
                        await printRawBase64(out.raw_base64, form.receipt_printer_name || null)
                        setActionToast({ kind: 'ok', message: t('admin.settings.testReceiptOk') })
                      } catch (e: unknown) {
                        const rawMessage = e instanceof Error ? e.message : String(e || '')
                        if (rawMessage.startsWith('Printer ulanmagan:')) {
                          setActionToast({ kind: 'err', message: rawMessage })
                          return
                        }
                        const code = (e as Error & { code?: string }).code
                        setActionToast({
                          kind: 'err',
                          message: t(`err.${code || 'TEST_RECEIPT_FAILED'}`),
                        })
                      }
                    }}
                  >
                    {t('admin.settings.testReceipt')}
                  </button>
                  <select
                    className={inputSoftCls}
                    value={form.receipt_width}
                    onChange={(e) => setForm({ ...form, receipt_width: e.target.value as '58mm' | '80mm' })}
                  >
                    <option value="58mm">58mm</option>
                    <option value="80mm">80mm</option>
                  </select>
                  
                  <div className="flex justify-between pt-2">
                  <label className="flex items-center gap-3 min-h-12 text-base">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={form.auto_print_on_sale}
                      onChange={(e) => setForm({ ...form, auto_print_on_sale: e.target.checked })}
                    />
                    {t('admin.settings.autoPrintOnSale')}
                  </label>
                    <button
                      type="button"
                      className="touch-btn min-h-12 px-6 rounded-xl bg-emerald-700 border border-emerald-500 font-medium"
                      onClick={() => setHwStep(2)}
                    >
                      {t('admin.settings.hwWizard.next')}
                    </button>
                  </div>
                </div>
              )}

              {hwStep === 2 && (
                <div className="space-y-3">
                  <div className="text-slate-300">{t('admin.settings.hwWizard.step2')}</div>
                  <label className="block text-xs text-slate-400">{t('admin.settings.labelPrinterName')}</label>
                  <input
                    list="printer-options"
                    className={inputSoftCls}
                    value={form.label_printer_name}
                    onChange={(e) => setForm({ ...form, label_printer_name: e.target.value })}
                    placeholder={t('admin.settings.labelPrinterNameExample')}
                  />
                  <label className="block text-xs text-slate-400">
                    {t('admin.settings.labelPrinterPortLabel', { defaultValue: 'Label port (e.g. USB002)' })}
                  </label>
                  <input
                    className={inputSoftCls}
                    value={form.label_printer_port || ''}
                    onChange={(e) => setForm({ ...form, label_printer_port: e.target.value })}
                    placeholder="USB002"
                  />
                  <select
                    className={inputSoftCls}
                    value={form.label_printer_type}
                    onChange={(e) =>
                      setForm({ ...form, label_printer_type: e.target.value as 'ESC_POS' | 'TSPL' })
                    }
                  >
                    <option value="TSPL">TSPL</option>
                    <option value="ESC_POS">ESC/POS</option>
                  </select>
                  <button
                    type="button"
                    className="touch-btn min-h-12 px-5 rounded-xl bg-slate-800 border border-slate-600"
                    onClick={async () => {
                      try {
                        const out = await testLabelPrintPayload()
                        // Settings wizard test should go to the explicitly selected label printer.
                        await printRawBase64(out.raw_base64, form.label_printer_name || null)
                        setActionToast({ kind: 'ok', message: t('admin.settings.testLabelOk') })
                      } catch (e: unknown) {
                        const rawMessage = e instanceof Error ? e.message : String(e || '')
                        if (rawMessage.startsWith('Printer ulanmagan:')) {
                          setActionToast({ kind: 'err', message: rawMessage })
                          return
                        }
                        const code = (e as Error & { code?: string }).code
                        setActionToast({
                          kind: 'err',
                          message: t(`err.${code || 'TEST_LABEL_FAILED'}`),
                        })
                      }
                    }}
                  >
                    {t('admin.settings.testLabel')}
                  </button>
                  <div className="flex justify-between gap-3 pt-2">
                    <button
                      type="button"
                      className="touch-btn min-h-12 px-6 rounded-xl bg-slate-800 border border-slate-600"
                      onClick={() => setHwStep(1)}
                    >
                      {t('admin.settings.hwWizard.back')}
                    </button>
                    <button
                      type="button"
                      className="touch-btn min-h-12 px-6 rounded-xl bg-emerald-700 border border-emerald-500 font-medium"
                      onClick={() => setHwStep(3)}
                    >
                      {t('admin.settings.hwWizard.next')}
                    </button>
                  </div>
                </div>
              )}

              {hwStep === 3 && (
                <div className="space-y-3">
                  <div className="text-slate-300">{t('admin.settings.hwWizard.step3')}</div>
                  <select
                    className={inputSoftCls}
                    value={form.scanner_mode}
                    onChange={(e) => setForm({ ...form, scanner_mode: e.target.value as 'keyboard' | 'serial' })}
                  >
                    <option value="keyboard">{t('admin.settings.scannerModeKeyboard')}</option>
                    <option value="serial">{t('admin.settings.scannerModeSerial')}</option>
                  </select>
                  {form.scanner_mode === 'serial' && (
                    <p className="text-xs text-amber-200/90 rounded-lg border border-amber-700/50 bg-amber-950/30 p-2">
                      {t('admin.settings.scannerSerialHint')}
                    </p>
                  )}
                  <label className="block text-xs text-slate-400">{t('admin.settings.scannerPrefix')}</label>
                  <input
                    className={inputSoftCls}
                    value={form.scanner_prefix}
                    onChange={(e) => setForm({ ...form, scanner_prefix: e.target.value })}
                    placeholder={t('admin.settings.scannerPrefixExample')}
                  />
                  <label className="block text-xs text-slate-400">{t('admin.settings.scannerSuffix')}</label>
                  <input
                    className={inputSoftCls}
                    value={form.scanner_suffix}
                    onChange={(e) => setForm({ ...form, scanner_suffix: e.target.value })}
                    placeholder={t('admin.settings.scannerSuffixExample')}
                  />
                  <p className="text-xs text-slate-500">{t('admin.settings.scannerSuffixHelp')}</p>
                  <input
                    className={inputSoftCls}
                    value={scannerTest}
                    onChange={(e) => {
                      const raw = e.target.value
                      const suffixRaw = (form.scanner_suffix || '').trim()
                      const suffix = suffixRaw === '\\t' ? '\t' : suffixRaw === '\\n' ? '\n' : suffixRaw
                      const normalized = suffix && raw.includes(suffix) ? raw.replaceAll(suffix, '') : raw
                      setScannerTest(normalized)
                      setScannerTestOk(Boolean(normalized.trim()))
                    }}
                    placeholder={t('admin.settings.scannerTestField')}
                  />
                  {scannerTestOk && <div className="text-sm text-emerald-400">{t('admin.settings.scannerTestOk')}</div>}
                  <div className="flex justify-between gap-3 pt-2">
                    <button
                      type="button"
                      className="touch-btn min-h-12 px-6 rounded-xl bg-slate-800 border border-slate-600"
                      onClick={() => setHwStep(2)}
                    >
                      {t('admin.settings.hwWizard.back')}
                    </button>
                    <button
                      type="button"
                      className="touch-btn min-h-12 px-6 rounded-xl bg-emerald-800 border border-emerald-600 font-medium"
                      onClick={() => setHwStep(1)}
                    >
                      {t('admin.settings.hwWizard.restartWizard')}
                    </button>
                  </div>
                </div>
              )}
            </div>
              </div>
              <div className="space-y-4 xl:sticky xl:top-4">
            <div className={sectionCardCls}>
            <label className="text-sm flex items-center gap-2 hidden">
              <input
                type="checkbox"
                checked={form.transliterate_uz}
                onChange={(e) => setForm({ ...form, transliterate_uz: e.target.checked })}
              />
              {t('admin.settings.transliterate')}
            </label>
            <label className="block text-xs text-slate-400">
              {t('admin.settings.lockTimeout', { defaultValue: 'Auto-lock timeout (minutes)' })}
            </label>
            <input
              type="number"
              min={1}
              max={240}
              className={inputCls}
              value={String(form.lock_timeout_minutes ?? 5)}
              onChange={(e) =>
                setForm({ ...form, lock_timeout_minutes: Math.max(1, Number(e.target.value || 5)) })
              }
            />
            </div>
            <div className={sectionCardCls}>
              <div className="inline-flex items-center gap-2 text-slate-200">
                <Cog className="h-4 w-4 text-emerald-400" />
                <h3 className="font-medium">{t('admin.settings.inventoryPricing', { defaultValue: 'Inventory & Pricing' })}</h3>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs text-slate-400">
                    {t('admin.settings.lowStockThreshold', { defaultValue: 'Low Stock Threshold (units)' })}
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className={inputCls}
                    value={form.low_stock_threshold ?? 3}
                    onChange={(e) => {
                      const val = Math.max(1, Number(e.target.value || 3))
                      setForm({ ...form, low_stock_threshold: val })
                    }}
                  />
                  <p className="text-xs text-slate-500">
                    {t('admin.settings.lowStockThresholdHelp', { defaultValue: 'Products below this quantity will be marked as low stock' })}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 min-h-12 text-base">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={form.show_price_on_labels_default ?? true}
                      onChange={(e) => {
                        setForm({ ...form, show_price_on_labels_default: e.target.checked })
                      }}
                    />
                    {t('admin.settings.showPriceOnLabels', { defaultValue: 'Show price on labels by default' })}
                  </label>
                  <p className="text-xs text-slate-500">
                    {t('admin.settings.showPriceOnLabelsHelp', { defaultValue: 'Display selling price on printed stickers' })}
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 min-h-12 text-base">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={form.show_selling_price_in_catalog ?? false}
                      onChange={(e) => {
                        setForm({ ...form, show_selling_price_in_catalog: e.target.checked })
                      }}
                    />
                    {t('admin.settings.showSellingPrice', { defaultValue: 'Show selling price in catalog' })}
                  </label>
                  <p className="text-xs text-slate-500">
                    {t('admin.settings.showSellingPriceHelp', { defaultValue: 'Display selling price in product list and POS' })}
                  </p>
                </div>
              </div>
            </div>
            
              <div className="flex flex-wrap gap-2 items-center rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
        <HardDriveDownload className="h-5 w-5 text-emerald-400 shrink-0" />
        <div className="mr-auto">
          <div className="font-medium text-slate-200">{t('admin.settings.backupNow')}</div>
          <div className="text-xs text-slate-400">{t('admin.settings.backupHint')}</div>
        </div>
        <button
          type="button"
          className="touch-btn min-h-12 px-3 py-2 rounded bg-slate-800 border border-slate-700 disabled:opacity-50"
          disabled={backupBusy}
          onClick={async () => {
            setBackupBusy(true)
            try {
              const res = await onBackupNow()
              setBackupMsg(res.backup_path)
              setActionToast({
                kind: 'ok',
                message: `${t('admin.settings.backupSuccess')}: ${shortBackupName(res.backup_path)}`,
              })
            } catch (e: unknown) {
              const code = (e as Error & { code?: string }).code
              const message = t(`err.${code || 'BACKUP_FAILED'}`, {
                defaultValue: t('err.BACKUP_FAILED'),
              })
              setActionToast({ kind: 'err', message: `${message}. ${t('admin.settings.backupRetry', { defaultValue: 'Qayta urinib ko‘ring.' })}` })
            } finally {
              setBackupBusy(false)
            }
          }}
        >
          {backupBusy ? t('admin.settings.backingUp') : t('admin.settings.backupNow')}
        </button>
        {backupMsg && <span className="text-xs text-slate-400">{backupMsg}</span>}
      </div>
              </div>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="touch-btn min-h-14 px-6 rounded-xl bg-emerald-700 border border-emerald-500 disabled:opacity-40 text-base font-semibold"
            >
              {busy ? t('admin.common.saving') : t('admin.settings.saveSettings')}
            </button>
          </form>
        </>
      )}
      {activeTab === 'bots' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 inline-flex items-center gap-2 text-slate-200">
            <Bot className="h-5 w-5 text-emerald-400" />
            <span className="font-medium">{t('admin.settings.tabBots')}</span>
          </div>
          <p className="text-xs text-slate-400">{t('admin.settings.botsHelp', { defaultValue: 'Telegram/WhatsApp sozlamalarini to‘ldiring va asosiy kanalni tanlang.' })}</p>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 space-y-2">
            <h3 className="font-medium">{t('admin.bots.telegram')}</h3>
            <label className="block text-xs text-slate-400">{t('admin.bots.telegramToken')}</label>
            <input
              className="touch-btn min-h-12 w-full px-3 py-2 rounded bg-slate-950 border border-slate-700"
              value={integrationForm.telegram_bot_token}
              onChange={(e) => setIntegrationForm((p) => ({ ...p, telegram_bot_token: e.target.value }))}
              placeholder={t('admin.bots.telegramToken')}
              onFocus={() => {
                if ((integrationForm.telegram_bot_token || '').includes('*')) {
                  setIntegrationForm((p) => ({ ...p, telegram_bot_token: '' }))
                }
              }}
            />
            <label className="block text-xs text-slate-400">{t('admin.bots.telegramChatId')}</label>
            <input
              className="touch-btn min-h-12 w-full px-3 py-2 rounded bg-slate-950 border border-slate-700"
              value={integrationForm.telegram_chat_id}
              onChange={(e) => setIntegrationForm((p) => ({ ...p, telegram_chat_id: e.target.value }))}
              placeholder={t('admin.bots.telegramChatId')}
            />
          </div>
          <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 space-y-2">
            <h3 className="font-medium">{t('admin.bots.whatsapp')}</h3>
            <label className="block text-xs text-slate-400">{t('admin.bots.whatsappApiBase')}</label>
            <input
              className="touch-btn min-h-12 w-full px-3 py-2 rounded bg-slate-950 border border-slate-700"
              value={integrationForm.whatsapp_api_base}
              onChange={(e) => setIntegrationForm((p) => ({ ...p, whatsapp_api_base: e.target.value }))}
              placeholder={t('admin.bots.whatsappApiBase')}
            />
            <p className="text-xs text-slate-500">{t('admin.bots.whatsappApiBaseHelp')}</p>
            <label className="block text-xs text-slate-400">{t('admin.bots.whatsappProvider')}</label>
            <select
              className="touch-btn min-h-12 w-full px-3 py-2 rounded bg-slate-950 border border-slate-700"
              value={integrationForm.whatsapp_provider}
              onChange={(e) =>
                setIntegrationForm((p) => ({
                  ...p,
                  whatsapp_provider: e.target.value as 'GREEN_API' | 'CUSTOM',
                }))
              }
            >
              <option value="GREEN_API">GreenAPI</option>
              <option value="CUSTOM">Custom API</option>
            </select>
            {integrationForm.whatsapp_provider === 'GREEN_API' && (
              <>
                <label className="block text-xs text-slate-400">{t('admin.bots.greenApiInstanceId')}</label>
                <input
                  className="touch-btn min-h-12 w-full px-3 py-2 rounded bg-slate-950 border border-slate-700"
                  value={integrationForm.greenapi_instance_id}
                  onChange={(e) => setIntegrationForm((p) => ({ ...p, greenapi_instance_id: e.target.value }))}
                  placeholder={t('admin.bots.greenApiInstanceId')}
                />
                <label className="block text-xs text-slate-400">{t('admin.bots.greenApiTokenInstance')}</label>
                <input
                  className="touch-btn min-h-12 w-full px-3 py-2 rounded bg-slate-950 border border-slate-700"
                  value={integrationForm.greenapi_api_token_instance}
                  onChange={(e) =>
                    setIntegrationForm((p) => ({ ...p, greenapi_api_token_instance: e.target.value }))
                  }
                  placeholder={t('admin.bots.greenApiTokenInstance')}
                  onFocus={() => {
                    if ((integrationForm.greenapi_api_token_instance || '').includes('*')) {
                      setIntegrationForm((p) => ({ ...p, greenapi_api_token_instance: '' }))
                    }
                  }}
                />
              </>
            )}
            <label className="block text-xs text-slate-400">{t('admin.bots.whatsappToken')}</label>
            <input
              className="touch-btn min-h-12 w-full px-3 py-2 rounded bg-slate-950 border border-slate-700"
              value={integrationForm.whatsapp_api_token}
              onChange={(e) => setIntegrationForm((p) => ({ ...p, whatsapp_api_token: e.target.value }))}
              placeholder={t('admin.bots.whatsappToken')}
              onFocus={() => {
                if ((integrationForm.whatsapp_api_token || '').includes('*')) {
                  setIntegrationForm((p) => ({ ...p, whatsapp_api_token: '' }))
                }
              }}
            />
            <label className="block text-xs text-slate-400">{t('admin.bots.whatsappSender')}</label>
            <input
              className="touch-btn min-h-12 w-full px-3 py-2 rounded bg-slate-950 border border-slate-700"
              value={integrationForm.whatsapp_sender}
              onChange={(e) => setIntegrationForm((p) => ({ ...p, whatsapp_sender: e.target.value }))}
              placeholder={t('admin.bots.whatsappSender')}
            />
            <label className="block text-xs text-slate-400">{t('admin.bots.primaryChannel', { defaultValue: 'Primary Z-Report channel' })}</label>
            <select
              className="touch-btn min-h-12 w-full px-3 py-2 rounded bg-slate-950 border border-slate-700"
              value={integrationForm.primary_report_channel || 'both'}
              onChange={(e) =>
                setIntegrationForm((p) => ({
                  ...p,
                  primary_report_channel: e.target.value as 'telegram' | 'whatsapp' | 'both',
                }))
              }
            >
              <option value="telegram">Telegram</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="both">Both</option>
            </select>
          </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className="touch-btn min-h-12 px-4 py-2 rounded bg-emerald-700 border border-emerald-500 disabled:opacity-40"
              onClick={async () => {
                setBusy(true)
                try {
                  await runAction(t('admin.bots.save'), () => onSaveIntegrations(integrationForm))
                } finally {
                  setBusy(false)
                }
              }}
            >
              {t('admin.bots.save')}
            </button>
            <button
              type="button"
              disabled={busy}
              className="touch-btn min-h-12 px-4 py-2 rounded bg-slate-800 border border-slate-700 disabled:opacity-40"
              onClick={async () => {
                setBusy(true)
                try {
                  await runAction(t('admin.bots.sendZReport'), () => onSendZReport())
                } finally {
                  setBusy(false)
                }
              }}
            >
              {t('admin.bots.sendZReport')}
            </button>
          </div>
        </div>
      )}
      {activeTab === 'security' && (
        <div className="space-y-3 max-w-4xl">
          <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 inline-flex items-center gap-2 text-slate-200">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            <span className="font-medium">{t('admin.settings.tabSecurity')}</span>
          </div>
          <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4 space-y-3">
            <h3 className="text-lg font-semibold">{t('license.title')}</h3>
            <div className="text-sm text-slate-300 space-y-1">
              <p>
                {t('license.demoCardTitle', { defaultValue: 'Demo muddat: {{left}} kun qoldi', left: licenseStatus?.demo_days_left ?? 0 })}
              </p>
              <p>
                {t('license.demoExpires', { defaultValue: 'Demo tugash sanasi' })}: {licenseStatus?.demo_expires_at || '-'}
              </p>
              <p>
                {t('license.expiresLabel')}: {licenseStatus?.expires_at || '-'}
              </p>
              <p className="break-all">
                {t('license.hardwareIdLabel', { defaultValue: 'Hardware ID' })}: {hardwareId || t('admin.common.na')}
              </p>
            </div>
            <div className="rounded-xl border border-sky-700/60 bg-sky-950/30 p-3 text-sm text-sky-100 space-y-1">
              <p className="font-medium">{t('license.contactDeveloperTitle')}</p>
              <p className="text-sky-200/90">{t('license.contactDeveloperHint')}</p>
              <p className="text-sky-200/90">{t('license.contactDeveloperTelegram1')}</p>
              <p className="text-sky-200/90">{t('license.contactDeveloperTelegram2')}</p>
              <p className="text-sky-200/90">{t('license.contactDeveloperPhone1')}</p>
              <p className="text-sky-200/90">{t('license.contactDeveloperPhone2')}</p>
            </div>
            <input
              className="touch-btn w-full min-h-14 px-4 rounded-xl bg-slate-950 border border-slate-700 text-base"
              value={activationKey}
              onChange={(e) => setActivationKey(e.target.value)}
              placeholder={t('license.keyPlaceholder')}
            />
            <button
              type="button"
              disabled={licenseBusy || !activationKey.trim() || !hardwareId.trim()}
              className="touch-btn min-h-12 px-5 rounded-xl bg-emerald-700 border border-emerald-500 disabled:opacity-50"
              onClick={async () => {
                setLicenseBusy(true)
                try {
                  const next = await activateLicense(hardwareId.trim(), activationKey.trim())
                  setLicenseStatus(next)
                  setActivationKey('')
                  setActionToast({ kind: 'ok', message: t('license.activate') })
                } catch (e: unknown) {
                  const code = (e as Error & { code?: string }).code
                  setActionToast({
                    kind: 'err',
                    message: t(`err.${code || 'LICENSE_ACTIVATE_FAILED'}`, { defaultValue: t('msg.errorGeneric') }),
                  })
                } finally {
                  setLicenseBusy(false)
                }
              }}
            >
              {licenseBusy ? t('admin.common.saving') : t('license.activate')}
            </button>
          </div>
          <h3 className="text-lg font-semibold">{t('admin.settings.pinUsers', { defaultValue: 'User PIN management' })}</h3>
          <div className="rounded-2xl border border-slate-700 overflow-hidden bg-slate-900/40">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  <th className="text-left p-2">{t('auth.username')}</th>
                  <th className="text-left p-2">{t('admin.sales.role', { defaultValue: 'Role' })}</th>
                  <th className="text-left p-2">{t('auth.pin', { defaultValue: 'PIN' })}</th>
                  <th className="text-right p-2">{t('admin.catalog.action')}</th>
                </tr>
              </thead>
              <tbody>
                {pinUsers.map((u) => (
                  <tr key={u.username} className="border-t border-slate-800">
                    <td className="p-2">{u.display_name}</td>
                    <td className="p-2">{u.role}</td>
                    <td className="p-2">
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        className="touch-btn min-h-12 w-32 px-3 py-2 rounded bg-slate-950 border border-slate-700 text-base"
                        value={pinDrafts[u.username] || ''}
                        onChange={(e) =>
                          setPinDrafts((p) => ({
                            ...p,
                            [u.username]: e.target.value.replace(/\D/g, '').slice(0, 4),
                          }))
                        }
                        placeholder={u.pin_enabled ? '****' : '1234'}
                      />
                    </td>
                    <td className="p-2 text-right">
                      <div className="inline-flex gap-2">
                        <button
                          type="button"
                          className="touch-btn min-h-12 px-3 py-2 rounded bg-emerald-700 border border-emerald-500"
                          onClick={async () => {
                            const pin = pinDrafts[u.username] || ''
                            if (pin.length !== 4) return
                            await runAction(t('admin.settings.saveSettings'), async () => {
                              await setUserPin(u.username, pin, true)
                              setPinUsers(await fetchPinUsers())
                            })
                          }}
                        >
                          {t('admin.common.save')}
                        </button>
                        <button
                          type="button"
                          className="touch-btn min-h-12 px-3 py-2 rounded bg-slate-800 border border-slate-700"
                          onClick={async () => {
                            await runAction(t('admin.settings.saveSettings'), async () => {
                              await setUserPin(u.username, '0000', false)
                              setPinUsers(await fetchPinUsers())
                            })
                          }}
                        >
                          {t('admin.settings.resetPin', { defaultValue: 'Reset' })}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      

      {canManageInventory && (
        <div className="pt-6 border-t border-slate-800 space-y-3">
          <h3 className="text-lg font-semibold">{t('admin.settings.stocktakeTitle')}</h3>
          {!stocktake && (
          <div className="flex flex-wrap gap-2">
            <input
              className="touch-btn min-h-12 px-3 py-2 rounded bg-slate-900 border border-slate-700"
              value={stocktakeNote}
              onChange={(e) => setStocktakeNote(e.target.value)}
              placeholder={t('admin.settings.sessionNote')}
            />
            <button
              type="button"
              className="touch-btn min-h-12 px-3 py-2 rounded bg-emerald-700 border border-emerald-500 disabled:opacity-50"
              disabled={stocktakeBusy}
              onClick={async () => {
                setStocktakeBusy(true)
                try {
                  await runAction(t('admin.settings.stocktakeStart'), () => onCreateStocktake(stocktakeNote))
                } finally {
                  setStocktakeBusy(false)
                }
              }}
            >
              {stocktakeBusy ? t('admin.settings.starting') : t('admin.settings.stocktakeStart')}
            </button>
            <button
              type="button"
              className="touch-btn min-h-12 px-3 py-2 rounded bg-slate-800 border border-slate-700 disabled:opacity-50"
              disabled={stocktakeBusy}
              onClick={async () => {
                setStocktakeBusy(true)
                try {
                  await runAction(t('admin.settings.stocktakeReload'), () => onReloadOpen())
                } finally {
                  setStocktakeBusy(false)
                }
              }}
            >
              {t('admin.settings.reopenSession')}
            </button>
          </div>
          )}
          {stocktake && (
          <div className="space-y-2">
            <div className="text-sm text-slate-400">
              {t('admin.settings.session')}: {stocktake.id.slice(0, 8)} | {t('admin.sales.status')}:{' '}
              {t(`status.${stocktake.status}`, { defaultValue: stocktake.status })}
            </div>
            <div className="max-h-72 overflow-auto kiosk-scrollbar rounded border border-slate-800">
              <table className="w-full text-sm">
                <thead className="bg-slate-900 text-slate-400">
                  <tr>
                    <th className="text-left p-2">{t('admin.catalog.product')}</th>
                    <th className="text-left p-2">{t('admin.catalog.color')}</th>
                    <th className="text-left p-2">{t('admin.catalog.barcode')}</th>
                    <th className="text-right p-2">{t('admin.settings.expected')}</th>
                    <th className="text-right p-2">{t('admin.settings.counted')}</th>
                    <th className="text-right p-2">{t('admin.settings.variance')}</th>
                    <th className="text-right p-2">{t('admin.common.save')}</th>
                  </tr>
                </thead>
                <tbody>
                  {stocktake.lines.map((ln) => (
                    <tr key={ln.id} className="border-t border-slate-800">
                      <td className="p-2">
                        {i18n.language.startsWith('ru')
                          ? (ln as typeof ln & { product_name_ru?: string }).product_name_ru || ln.product_name_uz
                          : ln.product_name_uz}
                      </td>
                      <td className="p-2 text-slate-300">{ln.color || '-'}</td>
                      <td className="p-2">{ln.barcode}</td>
                      <td className="p-2 text-right">{ln.expected_qty}</td>
                      <td className="p-2 text-right">{ln.counted_qty ?? '-'}</td>
                      <td className="p-2 text-right">{ln.variance_qty}</td>
                      <td className="p-2 text-right">
                        <div className="inline-flex gap-2">
                          <input
                            className="touch-btn min-h-12 px-3 py-2 rounded bg-slate-950 border border-slate-700 w-32 text-base"
                            value={countByVariant[ln.variant] ?? ''}
                            onChange={(e) =>
                              setCountByVariant((p) => ({ ...p, [ln.variant]: e.target.value }))
                            }
                            placeholder={t('admin.settings.qty')}
                          />
                          <button
                            type="button"
                            className="touch-btn min-h-12 px-3 py-2 rounded bg-slate-800 border border-slate-600 disabled:opacity-50"
                            disabled={stocktakeBusy}
                            onClick={async () => {
                              setStocktakeBusy(true)
                              try {
                                await runAction(t('admin.settings.stocktakeCount'), () =>
                                  onSetCount(ln.variant, Number(countByVariant[ln.variant] || '0')),
                                )
                              } finally {
                                setStocktakeBusy(false)
                              }
                            }}
                          >
                            {t('admin.common.save')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {stocktake.status === 'OPEN' && (
              <button
                type="button"
                className="touch-btn min-h-12 px-3 py-2 rounded bg-amber-700 border border-amber-500 disabled:opacity-50"
                disabled={stocktakeBusy}
                onClick={async () => {
                  setStocktakeBusy(true)
                  try {
                    await runAction(t('admin.settings.stocktakeApply'), () => onApplyStocktake())
                  } finally {
                    setStocktakeBusy(false)
                  }
                }}
              >
                {t('admin.settings.applyVariance')}
              </button>
            )}
          </div>
          )}
        </div>
      )}
    </div>
  )
}
