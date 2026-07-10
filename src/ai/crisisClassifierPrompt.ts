/**
 * Browser-facing re-export of the server-owned crisis classifier contract.
 * Keeping one prompt/schema prevents channel drift across Talk, Journal,
 * Drift, voice backstops, and the Twilio SMS bridge.
 */
export {
  CRISIS_CLASSIFIER_PROMPT,
  CRISIS_CLASSIFIER_SCHEMA,
} from '../../functions/src/shared/crisisClassifier'
