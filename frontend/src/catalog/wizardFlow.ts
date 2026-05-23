import type { ClothingGender, ProductKind, ShopMode } from '../api'

export type WizardStepId = 'kind' | 'gender' | 'brand' | 'color' | 'matrix'

export function buildWizardSteps(
  shopMode: ShopMode,
  wizardKind: ProductKind | null,
  needsGenderStep: boolean,
): WizardStepId[] {
  if (shopMode === 'FOOTWEAR_ONLY') {
    return ['brand', 'color', 'matrix']
  }
  if (shopMode === 'CLOTHING_ONLY') {
    const steps: WizardStepId[] = ['brand']
    if (needsGenderStep) steps.push('gender')
    steps.push('color', 'matrix')
    return steps
  }
  const steps: WizardStepId[] = ['kind']
  const kind = wizardKind ?? 'FOOTWEAR'
  if (kind === 'CLOTHING' && needsGenderStep) steps.push('gender')
  steps.push('brand', 'color', 'matrix')
  return steps
}

export function resolveProductKind(shopMode: ShopMode, wizardKind: ProductKind | null): ProductKind {
  if (shopMode === 'FOOTWEAR_ONLY') return 'FOOTWEAR'
  if (shopMode === 'CLOTHING_ONLY') return 'CLOTHING'
  return wizardKind ?? 'FOOTWEAR'
}

export function resolveClothingGender(
  ageBand: 'children' | 'teen' | 'adult',
  defaultGender: ClothingGender | '',
  wizardGender: ClothingGender | null,
): ClothingGender {
  if (ageBand === 'children') return 'UNISEX'
  if (defaultGender) return defaultGender
  return wizardGender ?? 'MALE'
}
