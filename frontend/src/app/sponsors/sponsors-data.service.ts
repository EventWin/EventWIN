import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';
import {
  ApiError, ApiSponsor, ApiSponsorDeliverable, ApiSponsorFit, ApiSponsorFitEvaluation, ApiSponsorPayment,
  ApiSponsorshipActivity, ApiSponsorshipDeal, ApiSponsorshipPackage, DealReport, DealStatus,
  ImportReport, NetBudget, OrganizerItem, PortalData, PortalLink, RecommendationsResponse, ResourceLite, ScheduleItemLite,
  SponsorAlert, SponsorConflict, SummaryResponse
} from './sponsors.models';

const BASE = '/api';

/**
 * Tous les appels du module sponsors. L'en-tête X-Participant-Id est ajouté ici (et seulement ici) :
 * le projet n'a pas d'interceptor global. Voir docs/sponsors.md pour les limites de ce mécanisme.
 */
@Injectable({ providedIn: 'root' })
export class SponsorsDataService {
  private readonly http = inject(HttpClient);

  private headers(): HttpHeaders {
    const id = localStorage.getItem('participant_id') || '';
    return new HttpHeaders(id ? { 'X-Participant-Id': id } : {});
  }

  private opts(params?: Record<string, string | undefined | null>) {
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== null && value !== '') {
        httpParams = httpParams.set(key, value);
      }
    }
    return { headers: this.headers(), params: httpParams };
  }

  private wrap<T>(source: Observable<T>): Observable<T> {
    return source.pipe(catchError(err => throwError(() => this.normalize(err))));
  }

  normalize(err: unknown): ApiError {
    const e = err as HttpErrorResponse;
    const body = (e?.error ?? {}) as Record<string, unknown>;
    const fields: Record<string, string> = {};
    let message = '';
    if (e?.status === 0) {
      message = 'Serveur injoignable. Vérifiez que le backend est démarré.';
    } else if (e?.status === 403) {
      message = 'Accès réservé aux organisateurs.';
    } else if (e?.status === 404) {
      message = typeof body['detail'] === 'string' ? (body['detail'] as string) : 'Élément introuvable.';
    } else if (typeof body['detail'] === 'string') {
      message = body['detail'] as string;
    } else if (body && typeof body === 'object') {
      for (const [key, value] of Object.entries(body)) {
        if (key === 'duplicates' || key === 'conflicts') continue;
        const text = Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : '';
        if (text) fields[key] = text;
      }
      message = Object.values(fields)[0] ?? '';
    }
    return {
      status: e?.status ?? 0,
      message: message || 'Une erreur est survenue.',
      fields,
      duplicates: (body['duplicates'] as ApiSponsor[]) ?? [],
      conflicts: (body['conflicts'] as SponsorConflict[]) ?? []
    };
  }

  // --- Analyse -------------------------------------------------------------
  summary(event: string) { return this.wrap(this.http.get<SummaryResponse>(`${BASE}/sponsorship-summary/`, this.opts({ event }))); }
  recommendations(event: string, gap?: string) {
    return this.wrap(this.http.get<RecommendationsResponse>(`${BASE}/sponsorship-recommendations/`, this.opts({ event, gap })));
  }
  conflicts(event: string) { return this.wrap(this.http.get<SponsorConflict[]>(`${BASE}/sponsorship-conflicts/`, this.opts({ event }))); }
  alerts(event: string) { return this.wrap(this.http.get<SponsorAlert[]>(`${BASE}/sponsorship-alerts/`, this.opts({ event }))); }
  netBudget(event: string) { return this.wrap(this.http.get<NetBudget>(`${BASE}/sponsorship-net-budget/`, this.opts({ event }))); }
  evaluateFit(event: string, sponsorIds?: string[]) {
    return this.wrap(this.http.post<ApiSponsorFit[]>(`${BASE}/sponsor-fit/evaluate/`, { event, sponsor_ids: sponsorIds }, this.opts()));
  }

  fitEvaluations(event: string) {
    return this.wrap(this.http.get<ApiSponsorFitEvaluation[]>(`${BASE}/sponsor-fit-evaluations/`, this.opts({ event })));
  }

  // --- Sponsors ------------------------------------------------------------
  sponsors() { return this.wrap(this.http.get<ApiSponsor[]>(`${BASE}/sponsors/`, this.opts())); }
  createSponsor(body: Partial<ApiSponsor>, force = false) {
    return this.wrap(this.http.post<ApiSponsor>(`${BASE}/sponsors/`, body, this.opts({ force: force ? 'true' : undefined })));
  }
  updateSponsor(id: string, body: Partial<ApiSponsor>) { return this.wrap(this.http.patch<ApiSponsor>(`${BASE}/sponsors/${id}/`, body, this.opts())); }
  deleteSponsor(id: string) { return this.wrap(this.http.delete<void>(`${BASE}/sponsors/${id}/`, this.opts())); }
  quickCreate(sponsor: Partial<ApiSponsor>, deal: { event: string; package?: string | null; cash_amount?: string } | null, force = false) {
    return this.wrap(this.http.post<{ sponsor: ApiSponsor; deal: ApiSponsorshipDeal | null }>(
      `${BASE}/sponsors/quick-create/`, { sponsor, deal }, this.opts({ force: force ? 'true' : undefined })));
  }
  importCsv(file: File) {
    const form = new FormData();
    form.append('file', file);
    return this.wrap(this.http.post<ImportReport>(`${BASE}/sponsors/import/`, form, this.opts()));
  }

  // --- Packages ------------------------------------------------------------
  packages(event: string) { return this.wrap(this.http.get<ApiSponsorshipPackage[]>(`${BASE}/sponsorship-packages/`, this.opts({ event }))); }
  savePackage(body: Partial<ApiSponsorshipPackage>, id?: string) {
    return this.wrap(id
      ? this.http.patch<ApiSponsorshipPackage>(`${BASE}/sponsorship-packages/${id}/`, body, this.opts())
      : this.http.post<ApiSponsorshipPackage>(`${BASE}/sponsorship-packages/`, body, this.opts()));
  }
  deletePackage(id: string) { return this.wrap(this.http.delete<void>(`${BASE}/sponsorship-packages/${id}/`, this.opts())); }

  // --- Deals ---------------------------------------------------------------
  deals(event: string, mine = false) {
    return this.wrap(this.http.get<ApiSponsorshipDeal[]>(`${BASE}/sponsorship-deals/`, this.opts({ event, mine: mine ? '1' : undefined })));
  }
  deal(id: string) { return this.wrap(this.http.get<ApiSponsorshipDeal>(`${BASE}/sponsorship-deals/${id}/`, this.opts())); }
  createDeal(body: Partial<ApiSponsorshipDeal>) { return this.wrap(this.http.post<ApiSponsorshipDeal>(`${BASE}/sponsorship-deals/`, body, this.opts())); }
  updateDeal(id: string, body: Partial<ApiSponsorshipDeal>) { return this.wrap(this.http.patch<ApiSponsorshipDeal>(`${BASE}/sponsorship-deals/${id}/`, body, this.opts())); }
  transition(id: string, status: DealStatus, extra: { probability_percent?: number; lost_reason?: string } = {}) {
    return this.wrap(this.http.post<ApiSponsorshipDeal>(`${BASE}/sponsorship-deals/${id}/transition/`, { status, ...extra }, this.opts()));
  }
  assign(id: string, owner: string) { return this.wrap(this.http.post<ApiSponsorshipDeal>(`${BASE}/sponsorship-deals/${id}/assign/`, { owner }, this.opts())); }
  portalLink(id: string, sendEmail = false, toEmail?: string) {
    return this.wrap(this.http.post<PortalLink>(`${BASE}/sponsorship-deals/${id}/portal-link/`, { send_email: sendEmail, to_email: toEmail }, this.opts()));
  }
  report(id: string) { return this.wrap(this.http.get<DealReport>(`${BASE}/sponsorship-deals/${id}/report/`, this.opts())); }
  reportCsv(id: string) {
    return this.wrap(this.http.get(`${BASE}/sponsorship-deals/${id}/report-csv/`, { ...this.opts(), responseType: 'blob' }));
  }
  activities(deal: string) { return this.wrap(this.http.get<ApiSponsorshipActivity[]>(`${BASE}/sponsorship-activities/`, this.opts({ deal }))); }
  addNote(deal: string, message: string) {
    return this.wrap(this.http.post<ApiSponsorshipActivity>(`${BASE}/sponsorship-activities/`, { deal, action: 'note', message }, this.opts()));
  }

  // --- Contreparties et paiements ----------------------------------------
  deliverables(event: string) { return this.wrap(this.http.get<ApiSponsorDeliverable[]>(`${BASE}/sponsor-deliverables/`, this.opts({ event }))); }
  updateDeliverable(id: string, body: Partial<ApiSponsorDeliverable>) {
    return this.wrap(this.http.patch<ApiSponsorDeliverable>(`${BASE}/sponsor-deliverables/${id}/`, body, this.opts()));
  }
  payments(event: string) { return this.wrap(this.http.get<ApiSponsorPayment[]>(`${BASE}/sponsor-payments/`, this.opts({ event }))); }
  updatePayment(id: string, body: Partial<ApiSponsorPayment>) {
    return this.wrap(this.http.patch<ApiSponsorPayment>(`${BASE}/sponsor-payments/${id}/`, body, this.opts()));
  }

  scheduleItems(event: string) { return this.wrap(this.http.get<ScheduleItemLite[]>(`${BASE}/event-schedule-items/`, this.opts({ event }))); }
  resources(event: string) { return this.wrap(this.http.get<ResourceLite[]>(`${BASE}/resources/`, this.opts({ event }))); }

  // --- Organisateurs (lecture seule, module participants) -----------------
  organizers() { return this.wrap(this.http.get<OrganizerItem[]>(`${BASE}/participants/get_organizers/`, this.opts())); }

  // --- Portail (aucun en-tête organisateur) -------------------------------
  portal(token: string) { return this.http.get<PortalData>(`${BASE}/sponsor-portal/${encodeURIComponent(token)}/`); }
  submitAsset(token: string, deliverableId: string, assetUrl: string) {
    return this.http.post<PortalData>(
      `${BASE}/sponsor-portal/${encodeURIComponent(token)}/deliverables/${deliverableId}/submit-asset/`, { asset_url: assetUrl });
  }
}
