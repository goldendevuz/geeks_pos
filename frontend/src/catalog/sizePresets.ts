import type { AgeBand, ClothingGender, ProductKind } from '../api'

export type SizeLinePreset = AgeBand

export const FOOTWEAR_SIZE_RANGES: Record<SizeLinePreset, { min: number; max: number }> = {
  children: { min: 31, max: 36 },
  teen: { min: 36, max: 41 },
  adult: { min: 40, max: 45 },
}

const CLOTHING_CHILDREN = ['104', '110', '116', '122', '128', '134', '140', '146', '152']
const CLOTHING_TEEN_MALE = ['XS', 'S', 'M', 'L', 'XL']
const CLOTHING_TEEN_FEMALE = ['XS', 'S', 'M', 'L', 'XL']
const CLOTHING_ADULT_MALE = ['S', 'M', 'L', 'XL', 'XXL', '3XL']
const CLOTHING_ADULT_FEMALE = ['XS', 'S', 'M', 'L', 'XL', 'XXL']

export function clothingSizeValues(ageBand: SizeLinePreset, gender: ClothingGender): string[] {
  if (ageBand === 'children') return [...CLOTHING_CHILDREN]
  if (ageBand === 'teen') {
    if (gender === 'FEMALE') return [...CLOTHING_TEEN_FEMALE]
    return [...CLOTHING_TEEN_MALE]
  }
  if (gender === 'FEMALE') return [...CLOTHING_ADULT_FEMALE]
  return [...CLOTHING_ADULT_MALE]
}

export function footwearSizeValues(ageBand: SizeLinePreset): string[] {
  const range = FOOTWEAR_SIZE_RANGES[ageBand]
  const out: string[] = []
  for (let v = range.min; v <= range.max; v += 1) out.push(String(v))
  return out
}

export function sizeSortOrder(value: string, index: number): number {
  if (/^\d+$/.test(value)) return Number(value)
  return 1000 + index
}

export type SizeRow = {
  id: string
  value: string
  label_uz: string
  label_ru?: string
  kind?: ProductKind | ''
  age_band?: AgeBand | ''
  gender?: ClothingGender | ''
}

export function filterMatrixSizes(
  sizes: SizeRow[],
  opts: {
    productKind: ProductKind
    ageBand: SizeLinePreset
    gender: ClothingGender
  },
): SizeRow[] {
  const { productKind, ageBand, gender } = opts
  if (productKind === 'FOOTWEAR') {
    const range = FOOTWEAR_SIZE_RANGES[ageBand]
    return sizes
      .filter((s) => {
        if ((s.kind || '').trim() === 'CLOTHING') return false
        const n = Number(s.value)
        if (Number.isFinite(n) && (s.kind === 'FOOTWEAR' || !(s.kind || '').trim())) {
          return n >= range.min && n <= range.max
        }
        return false
      })
      .sort((a, b) => Number(a.value) - Number(b.value))
  }
  const wanted = new Set(clothingSizeValues(ageBand, ageBand === 'children' ? 'UNISEX' : gender))
  return sizes
    .filter((s) => {
      if (s.kind === 'CLOTHING') {
        const band = (s.age_band || '') as SizeLinePreset
        const g = (s.gender || '') as ClothingGender
        if (band && band !== ageBand) return false
        if (ageBand !== 'children' && g && g !== gender) return false
        return wanted.has(s.value)
      }
      return wanted.has(s.value) && !(s.kind || '').trim()
    })
    .sort((a, b) => {
      const ai = [...wanted].indexOf(a.value)
      const bi = [...wanted].indexOf(b.value)
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
    })
}
