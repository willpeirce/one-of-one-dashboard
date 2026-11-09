import type { MailchimpFacts } from '../../src/mailchimp/model.js';

/** Invented provider facts; raw API-shaped fixtures are under fixtures/mailchimp. */
export function mailchimpPresentationFacts(): MailchimpFacts {
  return {mode:'live',status:'live',fetchedAt:'2026-10-26T12:00:00Z',flowCoverage:'unknown',
    audience:{id:'invented-audience',contacts:720,subscribers:640,unsubscribed:60,cleaned:20},campaigns:[],reports:[],orders:[]};
}
