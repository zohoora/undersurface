import { t, type TranslationKey } from '../i18n'
import type { AllianceRepairReason } from '../types'

export function repairReasonLabelKey(reason: AllianceRepairReason): TranslationKey {
  return ({
    too_fast: 'ps.reason.tooFast',
    too_certain: 'ps.reason.tooCertain',
    too_much_advice: 'ps.reason.tooMuchAdvice',
    wrong_direction: 'ps.reason.wrongDirection',
    too_many_questions: 'ps.reason.tooManyQuestions',
    other: 'ps.reason.other',
  } as const)[reason]
}
export function repairReasonMessage(reason: AllianceRepairReason): string {
  return t(({
    too_fast: 'ps.repair.tooFast',
    too_certain: 'ps.repair.tooCertain',
    too_much_advice: 'ps.repair.tooMuchAdvice',
    wrong_direction: 'ps.repair.wrongDirection',
    too_many_questions: 'ps.repair.tooManyQuestions',
    other: 'ps.repair.other',
  } as const)[reason])
}
