import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ParticipantService } from '../../../services/participant.service';
import { Router, ActivatedRoute } from '@angular/router';

@Component({
  selector: 'app-participant-profile',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './participant-profile.component.html',
  styles: [`
    .ecard {
      padding: 18px 22px;
      border: 1.5px solid var(--line);
      border-left: 5px solid var(--accent);
      border-radius: 16px;
      background: #ffffff;
      transition: all 0.28s cubic-bezier(0.2, 0.9, 0.3, 1);
      box-shadow: 0 4px 14px -6px rgba(22, 26, 46, 0.05);
      position: relative;
    }
    .ecard:hover {
      transform: translateY(-4px) scale(1.008);
      border-color: rgba(124, 92, 255, 0.35);
      border-left-color: var(--accent);
      box-shadow: 0 14px 32px -8px rgba(124, 92, 255, 0.22), 0 4px 12px rgba(0, 0, 0, 0.04);
    }
    .ecard:hover .eicon {
      transform: scale(1.22) rotate(6deg);
    }
    .ecard:hover .evalue-pill {
      border-color: var(--accent);
      background: rgba(124, 92, 255, 0.06);
    }
    .ecard.editing { border-color: var(--accent); background: var(--ai-soft); box-shadow: 0 6px 20px -10px var(--accent); }
    .ecard.changed { border-style: dashed; border-width: 2px 2px 2px 4px; border-color: #f59e0b; background: #fffbeb; }
    .ecard.saved { border-color: #16a34a; background: #f0fdf4; animation: pop .4s ease; }
    @keyframes pop { 0% { transform: scale(.98); } 60% { transform: scale(1.01); } 100% { transform: scale(1); } }
    .ehead { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
    .etitle { color: var(--accent); display: flex; align-items: center; gap: 9px; flex: 1; min-width: 140px; font-size: 15px; font-weight: 700; }
    .eicon { font-size: 21px; transition: transform 0.25s ease; display: inline-block; }
    .ebadge { font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 999px; }
    .editing-b { background: #ede9fe; color: #6d28d9; }
    .changed-b { background: #fef3c7; color: #b45309; }
    .saved-b { background: #dcfce7; color: #15803d; }
    .eactions { display: flex; gap: 6px; }
    .icon-btn { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center;
                border: 1px solid var(--line); background: #fff; border-radius: 9px; cursor: pointer; color: var(--tx-2); transition: all .18s; }
    .icon-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); transform: translateY(-1px); }
    .icon-btn:disabled { opacity: .4; cursor: not-allowed; }
    .icon-btn.ok { background: #16a34a; border-color: #16a34a; color: #fff; }
    .icon-btn.ok:hover { color: #fff; background: #15803d; border-color: #15803d; }
    .ebody { margin-top: 10px; }
    .evalue-pill {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 8px 16px;
      background: var(--sub);
      border: 1px solid var(--line);
      border-radius: 12px;
      font-size: 14.5px;
      font-weight: 600;
      color: var(--tx);
      transition: all 0.22s ease;
    }
    .evalue-hint {
      font-size: 11px;
      font-weight: 500;
      color: var(--tx-3);
      margin-left: 6px;
    }
    .btn-back-tabs {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 600;
      color: var(--violet);
      background: rgba(124, 92, 255, 0.1);
      border: 1px solid rgba(124, 92, 255, 0.25);
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .btn-back-tabs:hover {
      background: var(--violet);
      color: #fff;
      transform: translateX(-2px);
      box-shadow: 0 4px 12px rgba(124, 92, 255, 0.35);
    }
    .ediff { margin-top: 8px; font-size: 13px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .ediff .old { text-decoration: line-through; color: var(--tx-2); }
    .ediff .new { font-weight: 600; color: #b45309; }
    .pcard { transition: all .4s ease; position: relative; }
    .pcard.pflash { animation: pflash 1.2s ease; box-shadow: 0 0 0 4px rgba(124,92,255,.25), 0 14px 34px -14px rgba(124,92,255,.6); }
    @keyframes pflash { 0% { transform: scale(.97); } 40% { transform: scale(1.025); } 100% { transform: scale(1); } }
    .pupdate { margin-top: 10px; font-size: 12.5px; font-weight: 600; color: #6d28d9; background: #ede9fe;
               padding: 6px 12px; border-radius: 999px; display: inline-flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .pupdate s { opacity: .6; font-weight: 500; }

    /* Onglets modernes avec icônes */
    .tab-nav {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .t-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      border-radius: 14px;
      font-size: 13.5px;
      font-weight: 600;
      color: var(--tx-2);
      background: var(--card);
      border: 1px solid var(--line);
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.2, 0.9, 0.3, 1);
    }
    .t-btn:hover {
      background: var(--sub);
      color: var(--tx);
      transform: translateY(-1px);
    }
    .t-btn.active {
      background: var(--ai);
      color: #fff;
      border-color: transparent;
      box-shadow: 0 4px 16px -4px rgba(124, 92, 255, 0.6);
      transform: translateY(-1px);
    }

    /* Grille Identité animée */
    .id-pane {
      animation: idIn 0.35s ease;
    }
    @keyframes idIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: none; }
    }
    .id-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 22px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .id-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 24px;
      max-width: 820px;
    }
    .id-card {
      position: relative;
      padding: 16px 20px;
      border-radius: 16px;
      background: #ffffff;
      border: 1px solid var(--line);
      display: flex;
      gap: 16px;
      align-items: center;
      transition: all 0.28s cubic-bezier(0.2, 0.9, 0.3, 1);
      box-shadow: 0 4px 14px -6px rgba(22, 26, 46, 0.05);
    }
    .id-card:hover {
      transform: translateY(-2px);
      border-color: rgba(124, 92, 255, 0.4);
      box-shadow: 0 10px 22px -8px rgba(124, 92, 255, 0.22);
    }
    .id-icon-box {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      flex-shrink: 0;
      box-shadow: 0 4px 10px -2px rgba(0, 0, 0, 0.06);
      transition: transform 0.25s ease;
    }
    .id-card:hover .id-icon-box {
      transform: scale(1.08) rotate(4deg);
    }
    .u-nom { background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; }
    .u-mail { background: #f0f7ff; color: #2563eb; border: 1px solid #dbeafe; }
    .u-tel { background: #f0fdf4; color: #16a34a; border: 1px solid #dcfce7; }
    .u-org { background: #faf5ff; color: #7c3aed; border: 1px solid #ede9fe; }

    .id-content {
      flex: 1;
      min-width: 0;
    }
    .id-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
      color: var(--tx-3);
      display: block;
      margin-bottom: 2px;
    }
    .id-val {
      font-family: "Space Grotesk", sans-serif;
      font-size: 15.5px;
      font-weight: 700;
      color: var(--tx);
      word-break: break-all;
      margin-bottom: 0;
    }
    .id-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 20px;
      background: rgba(124, 92, 255, 0.12);
      color: var(--violet);
    }
    .id-badge.verified {
      background: rgba(16, 185, 129, 0.14);
      color: #059669;
    }
    .id-badge.secondary {
      background: var(--sub);
      color: var(--tx-2);
    }

    /* Bouton préférences vert */
    .t-btn.pref-btn.active {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
      border-color: transparent !important;
      color: #fff !important;
      box-shadow: 0 4px 16px -4px rgba(16, 185, 129, 0.6) !important;
    }

    /* Bouton contraintes rouge */
    .t-btn.const-btn.active {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%) !important;
      border-color: transparent !important;
      color: #fff !important;
      box-shadow: 0 4px 16px -4px rgba(239, 68, 68, 0.6) !important;
    }
    .t-btn.const-btn:not(.active):hover {
      border-color: rgba(239, 68, 68, 0.4);
      color: #dc2626;
      background: rgba(239, 68, 68, 0.05);
    }

    /* Édition des cartes d'identité */
    .id-card.editing {
      align-items: flex-start;
      border-color: var(--violet);
      box-shadow: 0 8px 24px -4px rgba(124, 92, 255, 0.22);
      background: #faf9ff;
    }
    .id-edit-toggle {
      border: 0;
      background: transparent;
      font-size: 11px;
      font-weight: 600;
      color: var(--violet);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 7px;
      border-radius: 6px;
      transition: background 0.15s ease;
    }
    .id-edit-toggle:hover {
      background: rgba(124, 92, 255, 0.12);
    }
    .id-edit-box {
      margin-top: 6px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .id-edit-box .in-sm {
      padding: 7px 12px;
      font-size: 13.5px;
      border-radius: 9px;
    }
    .id-edit-actions {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
    }
    .id-btn {
      padding: 5px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s ease;
    }
    .equestion {
      font-size: 12.5px;
      color: var(--tx-2);
      margin: 4px 0 10px 0;
      line-height: 1.4;
      font-style: italic;
    }
    .id-btn.save {
      background: #10b981;
      color: #fff;
      border: none;
      box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3);
      min-width: 32px;
      height: 28px;
      justify-content: center;
      font-weight: 700;
      font-size: 14px;
    }
    .id-btn.save:hover {
      background: #059669;
    }
    .id-btn.cancel {
      background: #fff;
      color: var(--tx-2);
      border: 1px solid var(--line);
    }
    .id-btn.cancel:hover {
      background: var(--sub);
      color: var(--tx);
    }

    /* Zone discrète de suppression de profil avec petite icône */
    .id-danger-zone-compact {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 18px;
      border-radius: 14px;
      background: rgba(232, 69, 95, 0.04);
      border: 1px dashed rgba(232, 69, 95, 0.25);
      flex-wrap: wrap;
      margin-top: 10px;
    }
    .danger-compact-text {
      font-size: 12px;
      color: var(--tx-2);
      font-weight: 500;
    }
    .btn-trash-mini {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border-radius: 8px;
      color: var(--risk);
      background: #fff;
      border: 1px solid rgba(232, 69, 95, 0.35);
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .btn-trash-mini:hover {
      background: var(--risk);
      color: #fff;
      border-color: var(--risk);
      box-shadow: 0 4px 12px rgba(232, 69, 95, 0.3);
      transform: scale(1.06);
    }

    /* Bouton poubelle discret dans le header */
    .btn-header-trash {
      width: 38px;
      height: 38px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 11px;
      background: rgba(232, 69, 95, 0.08);
      color: var(--risk);
      border: 1px solid rgba(232, 69, 95, 0.25);
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .btn-header-trash:hover {
      background: var(--risk);
      color: #fff;
      border-color: var(--risk);
      transform: scale(1.08);
      box-shadow: 0 4px 14px rgba(232, 69, 95, 0.45);
    }

    /* Photo de profil & Avatar */
    .photo-card {
      display: flex;
      gap: 22px;
      padding: 22px;
      background: linear-gradient(135deg, rgba(124, 92, 255, 0.06) 0%, rgba(59, 130, 246, 0.05) 100%);
      border: 1.5px solid rgba(124, 92, 255, 0.22);
      border-radius: 20px;
      align-items: center;
      margin-bottom: 22px;
      flex-wrap: wrap;
      box-shadow: 0 6px 20px -6px rgba(124, 92, 255, 0.12);
    }
    .photo-left {
      flex-shrink: 0;
    }
    .photo-preview-box {
      position: relative;
      width: 96px;
      height: 96px;
      border-radius: 26px;
      box-shadow: 0 8px 24px -4px rgba(124, 92, 255, 0.35);
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--ai);
      border: 3.5px solid #fff;
      overflow: visible;
    }
    .photo-img-preview {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 23px;
    }
    .photo-initials-preview {
      font-family: "Space Grotesk", sans-serif;
      font-size: 32px;
      font-weight: 700;
      color: #fff;
      letter-spacing: 1px;
    }
    .photo-status-pill {
      position: absolute;
      bottom: -10px;
      left: 50%;
      transform: translateX(-50%);
      background: #1e1b4b;
      color: #c7d2fe;
      font-size: 10px;
      font-weight: 700;
      padding: 3px 9px;
      border-radius: 12px;
      white-space: nowrap;
      border: 1px solid rgba(255, 255, 255, 0.25);
      box-shadow: 0 3px 8px rgba(0,0,0,0.18);
    }
    .photo-status-pill.custom {
      background: #065f46;
      color: #a7f3d0;
    }
    .photo-right {
      flex: 1;
      min-width: 260px;
    }
    .photo-titles h4 {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      color: var(--tx);
    }
    .photo-titles p {
      margin: 4px 0 14px 0;
      font-size: 13px;
      color: var(--tx-2);
      line-height: 1.45;
    }
    .photo-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: center;
    }
    .btn-photo-action {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 16px;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.2, 0.9, 0.3, 1);
    }
    .btn-photo-action.upload {
      background: var(--violet);
      color: #fff;
      border: none;
      box-shadow: 0 4px 14px rgba(124, 92, 255, 0.35);
    }
    .btn-photo-action.upload:hover {
      background: #6d28d9;
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(124, 92, 255, 0.45);
    }
    .btn-photo-action.remove {
      background: #fff;
      color: var(--tx-2);
      border: 1px solid var(--line);
    }
    .btn-photo-action.remove:hover {
      background: var(--sub);
      color: var(--risk);
      border-color: rgba(232, 69, 95, 0.3);
    }
    .photo-presets {
      margin-top: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .preset-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--tx-2);
    }
    .preset-list {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .preset-btn {
      width: 48px;
      height: 48px;
      border-radius: 14px;
      border: 1.5px solid var(--line);
      background: #ffffff;
      padding: 3px;
      cursor: pointer;
      transition: all 0.22s cubic-bezier(0.2, 0.9, 0.3, 1);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    }
    .preset-btn img {
      width: 100%;
      height: 100%;
      border-radius: 11px;
      object-fit: cover;
    }
    .preset-btn:hover {
      transform: scale(1.15) translateY(-2px);
      border-color: var(--violet);
      box-shadow: 0 8px 20px rgba(124, 92, 255, 0.25);
    }
    .photo-alert {
      padding: 8px 14px;
      border-radius: 10px;
      background: rgba(16, 185, 129, 0.12);
      color: #059669;
      font-size: 12.5px;
      font-weight: 600;
      margin-bottom: 12px;
      animation: alertIn 0.25s ease;
    }
    .photo-error-alert {
      padding: 8px 14px;
      border-radius: 10px;
      background: rgba(239, 68, 68, 0.12);
      color: #dc2626;
      font-size: 12.5px;
      font-weight: 600;
      margin-bottom: 12px;
      border: 1px solid rgba(239, 68, 68, 0.25);
      animation: alertIn 0.25s ease;
    }
    .id-field-error {
      color: #dc2626;
      font-size: 12px;
      font-weight: 600;
      margin-top: 4px;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    @keyframes alertIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: none; }
    }

    /* Avatar grand format dans l'en-tête */
    .big-av-wrap {
      position: relative;
      flex-shrink: 0;
    }
    .big-av {
      width: 74px;
      height: 74px;
      border-radius: 22px;
      background: var(--ai);
      display: grid;
      place-items: center;
      font-family: "Space Grotesk", sans-serif;
      font-size: 26px;
      font-weight: 700;
      color: #fff;
      box-shadow: var(--sh-ai);
      overflow: hidden;
      transition: transform 0.25s ease, box-shadow 0.25s ease;
    }
    .big-av-wrap:hover .big-av {
      transform: scale(1.05);
      box-shadow: 0 8px 24px rgba(124, 92, 255, 0.45);
    }
    .big-av-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .av-edit-badge {
      position: absolute;
      bottom: -3px;
      right: -3px;
      width: 26px;
      height: 26px;
      background: #fff;
      border: 1.5px solid var(--line);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.12);
      transition: transform 0.2s ease;
    }
    .big-av-wrap:hover .av-edit-badge {
      transform: scale(1.2);
      border-color: var(--violet);
    }

    /* Bouton Mon profil en bas du score */
    .btn-score-profile {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 10px;
      background: var(--violet);
      color: #fff;
      border: none;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 8px rgba(124, 92, 255, 0.3);
    }
    .btn-score-profile:hover {
      background: #6d28d9;
      transform: translateY(-1px);
      box-shadow: 0 4px 14px rgba(124, 92, 255, 0.45);
    }
  `]
})
export class ParticipantProfileComponent implements OnInit {
  participant: any = null;
  activeTab: string = 't-pref'; // Préférences par défaut pour participant

  get isOrganizer(): boolean {
    const role = this.participant?.role || (typeof window !== 'undefined' ? localStorage.getItem('participant_role') : '') || '';
    return role === 'organizer' || role === 'admin';
  }

  // Formulaire d'édition de l'identité
  idForm = {
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    organization: ''
  };
  editingId: { [key: string]: boolean } = {};
  idSuccessMsg: string = '';
  phoneErrorMsg: string = '';
  emailErrorMsg: string = '';
  nameErrorMsg: string = '';
  firstNameErrorMsg: string = '';
  lastNameErrorMsg: string = '';
  photoErrorMsg: string = '';

  availableOrganizations: string[] = ['Aucune'];

  // Questions exactes du quiz pour les préférences et contraintes (sans numérotation)
  quizQuestions: { [type: string]: string } = {
    'Alimentaire': 'Quel est votre régime alimentaire principal ?',
    'Allergies': 'Avez-vous des allergies ou intolérances spécifiques ?',
    'Boisson': 'Quelle est votre boisson de pause préférée ?',
    'Accessibilité': 'Avez-vous un besoin spécifique d\'accessibilité (PMR, etc.) ?',
    'Transport': 'Quel moyen de transport principal envisagez-vous ?',
    'Arrivée': 'Quel est votre moment d\'arrivée prévu à l\'événement ?',
    'Transfert': 'Avez-vous besoin d\'une navette / transfert (Gare/Aéroport) ?',
    'Budget (Max)': 'Quel est votre budget MAX global (Hôtel + Déplacements) ?',
    'Hébergement': 'Quel est votre type d\'hébergement préféré ?',
    'Partage Chambre': 'Accepteriez-vous de partager une chambre pour réduire les coûts ?',
    'Facturation': 'Aurez-vous besoin d\'une facture au nom de votre entreprise ?',
    'Objectif': 'Quel est votre objectif principal pour cet événement ?',
    'Format': 'Quel format de contenu privilégiez-vous ?',
    'Niveau': 'Quel est votre niveau d\'expérience sur les thèmes abordés ?',
    'Intérêt Tech': 'Quel est votre niveau d\'intérêt pour la Technologie & l\'Innovation ?',
    'Intérêt Sport': 'Quel est votre niveau d\'intérêt pour les activités physiques / sportives ?',
    'Ambiance': 'Quelle est l\'ambiance idéale pour vous pendant l\'événement ?',
    'Espace': 'Avez-vous besoin d\'un espace de travail calme (Coworking) ?',
    'Afterwork': 'Serez-vous présent aux soirées et afterworks ?',
    'Intérêt Social': 'Quelle est votre envie de rencontres et de socialisation ?'
  };

  questionFor(type: string): string {
    const q = this.quizQuestions[type] || '';
    return q.replace(/^\d+[\.\)]\s*/, '');
  }

  // Photo de profil & Avatar (Thématiques événementielles : rock, musique, calme, scène, festival)
  profilePhoto: string | null = null;
  photoSuccessMsg: string = '';
  availableAvatarPresets: { label: string; tag: string; url: string }[] = [
    {
      label: 'Smiley Musique & Casque Audio',
      tag: '🎧 Musique',
      url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="24" fill="%23eff6ff"/><path d="M22 50 C22 24 78 24 78 50" fill="none" stroke="%232563eb" stroke-width="6" stroke-linecap="round"/><circle cx="50" cy="52" r="28" fill="%23fcd34d"/><circle cx="36" cy="56" r="4.5" fill="%23f87171" opacity="0.45"/><circle cx="64" cy="56" r="4.5" fill="%23f87171" opacity="0.45"/><path d="M34 47 Q39 42 44 47" fill="none" stroke="%231e293b" stroke-width="3" stroke-linecap="round"/><path d="M56 47 Q61 42 66 47" fill="none" stroke="%231e293b" stroke-width="3" stroke-linecap="round"/><path d="M40 57 Q50 69 60 57" fill="%231e293b" stroke="%231e293b" stroke-width="2" stroke-linecap="round"/><path d="M43 58 Q50 65 57 58" fill="%23f43f5e"/><rect x="17" y="42" width="10" height="20" rx="5" fill="%231d4ed8"/><rect x="73" y="42" width="10" height="20" rx="5" fill="%231d4ed8"/><rect x="21" y="45" width="4" height="14" rx="2" fill="%2360a5fa"/><rect x="75" y="45" width="4" height="14" rx="2" fill="%2360a5fa"/><path d="M78 26 L86 23 V33 M78 26 V36" stroke="%233b82f6" stroke-width="2" stroke-linecap="round" fill="none"/><circle cx="76" cy="36" r="2.5" fill="%233b82f6"/><circle cx="84" cy="33" r="2.5" fill="%233b82f6"/></svg>'
    },
    {
      label: 'Smiley Style Rock & Lunettes',
      tag: '🎸 Rock',
      url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="24" fill="%23fef2f2"/><circle cx="50" cy="50" r="32" fill="%23fcd34d"/><circle cx="33" cy="58" r="4.5" fill="%23f87171" opacity="0.4"/><circle cx="67" cy="58" r="4.5" fill="%23f87171" opacity="0.4"/><path d="M44 44 H56" stroke="%230f172a" stroke-width="3.5" stroke-linecap="round"/><path d="M26 40 H45 V48 C45 55 38 58 31 56 C26 54 25 48 26 40 Z" fill="%230f172a"/><path d="M55 40 H74 V48 C74 55 67 58 60 56 C55 54 54 48 55 40 Z" fill="%230f172a"/><path d="M29 43 L36 53" stroke="%2394a3b8" stroke-width="2" stroke-linecap="round"/><path d="M58 43 L65 53" stroke="%2394a3b8" stroke-width="2" stroke-linecap="round"/><path d="M38 64 Q50 73 63 63" fill="none" stroke="%230f172a" stroke-width="3" stroke-linecap="round"/><path d="M76 34 L72 40 L76 40 L71 47" stroke="%23ef4444" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>'
    },
    {
      label: 'Smiley Calme & Détente',
      tag: '☕ Calme',
      url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="24" fill="%23f0fdf4"/><circle cx="50" cy="50" r="32" fill="%23fcd34d"/><circle cx="32" cy="56" r="5" fill="%23fca5a5" opacity="0.55"/><circle cx="68" cy="56" r="5" fill="%23fca5a5" opacity="0.55"/><path d="M31 46 Q38 52 45 46" fill="none" stroke="%231e293b" stroke-width="3" stroke-linecap="round"/><path d="M55 46 Q62 52 69 46" fill="none" stroke="%231e293b" stroke-width="3" stroke-linecap="round"/><path d="M41 62 Q50 68 59 62" fill="none" stroke="%231e293b" stroke-width="3" stroke-linecap="round"/><path d="M50 20 C50 14 56 12 56 12 C56 16 52 19 50 20 Z" fill="%2310b981"/><path d="M50 20 C50 15 45 13 45 13 C45 17 48 19 50 20 Z" fill="%2334d399"/><path d="M50 20 V24" stroke="%23059669" stroke-width="2" stroke-linecap="round"/></svg>'
    },
    {
      label: 'Smiley Festival & Étoiles',
      tag: '🌟 Festival',
      url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="24" fill="%23faf5ff"/><circle cx="50" cy="50" r="32" fill="%23fcd34d"/><circle cx="31" cy="57" r="5" fill="%23f472b6" opacity="0.45"/><circle cx="69" cy="57" r="5" fill="%23f472b6" opacity="0.45"/><polygon points="38,38 40,43 45,43 41,46 43,51 38,48 33,51 35,46 31,43 36,43" fill="%237c3aed"/><polygon points="62,38 64,43 69,43 65,46 67,51 62,48 57,51 59,46 55,43 60,43" fill="%237c3aed"/><path d="M37 59 Q50 74 63 59 Z" fill="%231e293b"/><path d="M42 63 Q50 71 58 63" fill="%23ec4899"/><circle cx="20" cy="28" r="2" fill="%23a855f7"/><circle cx="80" cy="26" r="2.5" fill="%23ec4899"/><circle cx="78" cy="74" r="2" fill="%233b82f6"/></svg>'
    },
    {
      label: 'Smiley Conférence & Lunettes Chics',
      tag: '👓 Pro',
      url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="24" fill="%23fffbeb"/><circle cx="50" cy="50" r="32" fill="%23fcd34d"/><circle cx="32" cy="57" r="4.5" fill="%23fb923c" opacity="0.4"/><circle cx="68" cy="57" r="4.5" fill="%23fb923c" opacity="0.4"/><circle cx="37" cy="46" r="9" fill="none" stroke="%23334155" stroke-width="2.5"/><circle cx="63" cy="46" r="9" fill="none" stroke="%23334155" stroke-width="2.5"/><path d="M46 46 Q50 43 54 46" fill="none" stroke="%23334155" stroke-width="2.5" stroke-linecap="round"/><circle cx="37" cy="46" r="3" fill="%231e293b"/><circle cx="36" cy="45" r="1" fill="%23ffffff"/><circle cx="63" cy="46" r="3" fill="%231e293b"/><circle cx="62" cy="45" r="1" fill="%23ffffff"/><path d="M40 61 Q50 68 60 61" fill="none" stroke="%231e293b" stroke-width="2.8" stroke-linecap="round"/><polygon points="46,80 54,80 50,83" fill="%2364748b"/></svg>'
    },
    {
      label: 'Smiley Clin d\'œil Radieux',
      tag: '✨ Complice',
      url: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="24" fill="%23f0f9ff"/><circle cx="50" cy="50" r="32" fill="%23fcd34d"/><circle cx="33" cy="57" r="4.5" fill="%23f87171" opacity="0.4"/><circle cx="67" cy="57" r="4.5" fill="%23f87171" opacity="0.4"/><path d="M31 47 Q38 41 45 47" fill="none" stroke="%231e293b" stroke-width="3" stroke-linecap="round"/><circle cx="62" cy="46" r="3.5" fill="%231e293b"/><circle cx="61" cy="45" r="1.2" fill="%23ffffff"/><path d="M38 59 Q50 72 62 59" fill="%231e293b" stroke="%231e293b" stroke-width="2" stroke-linecap="round"/><path d="M42 61 Q50 68 58 61" fill="%23f43f5e"/></svg>'
    }
  ];

  // Préférences
  newPrefType: string = 'Activités';
  newPrefValue: string = '';
  savedPreferences: any[] = [];

  // Contraintes
  newConstType: string = 'Alimentaire';
  newConstValue: string = '';
  newConstIsHard: boolean = false;
  savedConstraints: any[] = [];

  // Description des profils
  profileDescriptions: any = {
    'Social Butterfly 🦋': "Vous êtes l'âme de l'événement ! Votre but principal est d'agrandir votre réseau, d'échanger des idées et de partager des moments conviviaux.",
    'Geek / Tech Lover 💻': "La technologie et l'innovation n'ont aucun secret pour vous. Vous recherchez du contenu pointu, des nouveautés et des discussions techniques.",
    'Élève Studieux 📚': "Vous êtes ici pour apprendre et progresser. Vous privilégiez les ateliers pratiques et les masterclasses pour développer vos compétences.",
    'Explorateur Équilibré 🧭': "Polyvalent et curieux, vous aimez toucher à tout. Un peu de conférence, un peu de réseau, et beaucoup de découvertes."
  };

  getProfileType() {
    const prof = this.savedPreferences.find(p => p.type === 'Type de Profil');
    if (!prof) return null;
    
    // Le format est "Nom du Profil (Score: X)"
    const nameStr = prof.value.split(' (Score:')[0];
    const scoreStr = prof.value.match(/Score: (\d+)/)?.[1] || '';
    
    if (scoreStr) {
      localStorage.setItem('participant_score', scoreStr);
    }
    
    return {
      name: nameStr,
      score: scoreStr,
      desc: this.profileDescriptions[nameStr] || "Un profil unique et mystérieux prêt à découvrir l'événement."
    };
  }

  getEditablePreferences() {
    return this.savedPreferences.filter(p => p.type !== 'Type de Profil');
  }

  // --- Recalcul du profil (même règle que dans le quiz) ---
  profileFlash: boolean = false;
  profileChange: { from: string; to: string; fromScore: string; toScore: string } | null = null;
  /** Bonus Afterwork (0 ou 20) : non stocké en préférence, déduit du score d'origine. */
  private scoreBonus = 0;

  private prefValue(type: string): string {
    return this.savedPreferences.find(p => p.type === type)?.value ?? '';
  }

  private prefNumber(type: string): number {
    return parseInt(this.prefValue(type), 10) || 0;
  }

  private interestSum(): number {
    return this.prefNumber('Intérêt Tech') + this.prefNumber('Intérêt Social') + this.prefNumber('Intérêt Sport');
  }

  private initScoreBonus() {
    const prof = this.getProfileType();
    if (!prof) return;
    this.scoreBonus = Math.max(0, (parseInt(prof.score, 10) || 0) - this.interestSum() * 10);
  }

  private constValue(type: string): string {
    return this.savedConstraints.find(c => c.type === type)?.value ?? '';
  }

  private computeProfile(): { name: string; score: number } {
    const tech = this.prefNumber('Intérêt Tech');
    const social = this.prefNumber('Intérêt Social');
    const sport = this.prefNumber('Intérêt Sport');
    const goal = this.prefValue('Objectif');
    const format = this.prefValue('Format');
    const ambiance = this.prefValue('Ambiance');
    const afterwork = this.prefValue('Afterwork');
    const budget = this.constValue('Budget (Max)');
    const transport = this.constValue('Transport');
    const access = this.constValue('Accessibilité');
    const food = this.constValue('Alimentaire');

    // Base score des intérêts
    let score = (tech + social + sport) * 10 + this.scoreBonus;

    // Influence dynamique des contraintes sur le score :
    if (budget.includes('No Limit')) score += 25;
    else if (budget.includes('300€ - 600€')) score += 15;
    else if (budget.includes('100€ - 300€')) score += 10;
    else if (budget.includes('0 - 100€')) score += 5;

    if (transport.includes('Train') || transport.includes('Covoiturage')) score += 10;
    else if (transport.includes('Avion')) score += 5;

    if (access && access !== 'Aucun') score += 15; // Besoins spécifiques pris en compte
    if (food && food !== 'Aucun' && !food.includes('mange de tout')) score += 5;

    // Influence des préférences :
    if (afterwork.includes('Oui') || afterwork.includes('présent')) score += 20;
    if (ambiance.includes('Festif')) score += 15;
    else if (ambiance.includes('Détendu')) score += 10;

    let name: string;
    if (goal === 'Réseauter' || social >= 8 || ambiance.includes('Festif')) {
      name = 'Social Butterfly 🦋';
    } else if (tech > 7 || (format === 'Atelier Pratique' && tech >= 5)) {
      name = 'Geek / Tech Lover 💻';
    } else if (goal === 'Apprendre' || format === 'Conférence' || format === 'Atelier Pratique') {
      name = 'Élève Studieux 📚';
    } else {
      name = 'Explorateur Équilibré 🧭';
    }
    return { name, score };
  }

  /** Recalcule score + type de profil, met à jour l'affichage et la base. */
  private recomputeProfile() {
    const profPref = this.savedPreferences.find(p => p.type === 'Type de Profil');
    if (!profPref) return;

    const before = this.getProfileType();
    const { name, score } = this.computeProfile();
    const newValue = `${name} (Score: ${score})`;
    if (newValue === profPref.value) return;

    profPref.value = newValue; // l'affichage se met à jour immédiatement
    localStorage.setItem('participant_score', String(score));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('score-updated'));
    }
    this.participantService.updatePreference(profPref.id, newValue).subscribe();

    this.profileChange = {
      from: before?.name || '', to: name,
      fromScore: before?.score || '', toScore: String(score)
    };
    this.profileFlash = true;
    setTimeout(() => { this.profileFlash = false; this.profileChange = null; }, 5000);
  }

  // Options des listes déroulantes (toutes les questions du quiz)
  private choiceOptions: { [type: string]: string[] } = {
    'Alimentaire': ['Aucun', 'Je mange de tout', 'Végétarien', 'Vegan', 'Sans Gluten', 'Halal', 'Casher'],
    'Allergies': ['Aucune allergie', 'Arachides / Fruits à coque', 'Fruits de mer', 'Lactose', 'Gluten', 'Autre'],
    'Accessibilité': ['Aucun', 'PMR', 'Visuel/Auditif'],
    'Transport': ['Train', 'Avion', 'Voiture (Seul)', 'Covoiturage'],
    'Budget (Max)': ['0 - 100€', '100€ - 300€', '300€ - 600€', 'No Limit'],
    'Boisson': ['Café', 'Thé', 'Jus / Soda', 'Eau pure'],
    'Arrivée': ['La veille', 'Matin', 'Midi'],
    'Transfert': ['Oui, s\'il vous plaît', 'Non, je me débrouille'],
    'Hébergement': ['Hôtel 4* ou 5*', 'Hôtel standard', 'Airbnb / Appartement', 'Je n\'ai pas besoin de dormir sur place'],
    'Partage Chambre': ['Non', 'Oui'],
    'Facturation': ['Besoins d\'une facture pro', 'Pas de facture'],
    'Objectif': ['Apprendre', 'Réseauter', 'Inspiration'],
    'Format': ['Conférence', 'Atelier Pratique', 'Table Ronde'],
    'Niveau': ['Débutant', 'Intermédiaire', 'Expert'],
    'Ambiance': ['Calme et Studieux', 'Détendu et Informel', 'Festif'],
    'Espace': ['Besoin d\'un espace calme', 'Pas besoin d\'espace calme'],
    'Afterwork': ['Oui, présent ! 🍻', 'Non, repos 😴']
  };
  private sliderTypes = ['Intérêt Tech', 'Intérêt Social', 'Intérêt Sport'];

  // Icônes par rubrique
  private typeIcons: { [type: string]: string } = {
    'Alimentaire': '🍽️', 'Allergies': '⚠️', 'Boisson': '☕', 'Accessibilité': '♿', 'Transport': '🚆',
    'Budget (Max)': '💶', 'Arrivée': '🕘', 'Hébergement': '🏨', 'Facturation': '🧾',
    'Objectif': '🎯', 'Format': '🎤', 'Niveau': '📈', 'Ambiance': '🎉', 'Espace': '💻',
    'Transfert': '🚐', 'Partage Chambre': '👥', 'Afterwork': '🍻',
    'Intérêt Tech': '🤖', 'Intérêt Social': '🤝', 'Intérêt Sport': '🏃'
  };

  iconFor(type: string): string {
    return this.typeIcons[type] || '📝';
  }

  isSlider(type: string): boolean {
    return this.sliderTypes.includes(type);
  }

  /** Liste déroulante si la rubrique a des choix connus, sinon null (champ texte). */
  optionsFor(item: any): string[] | null {
    const base = this.choiceOptions[item.type];
    if (!base) return null;
    return base.includes(item.value) || !item.value ? base : [item.value, ...base];
  }

  sliderValue(item: any): number {
    return parseInt(String(item.value), 10) || 0;
  }

  setSlider(item: any, v: any) {
    item.value = `${v}/10`;
  }

  startEdit(item: any) {
    item.original = item.value;
    item.isEditing = true;
    item.justSaved = false;
  }

  /** Annule la modification et restaure la valeur d'origine. */
  resetEdit(item: any) {
    item.value = item.original;
  }

  cancelEdit(item: any) {
    item.value = item.original;
    item.isEditing = false;
  }

  isChanged(item: any): boolean {
    return item.isEditing && item.value !== item.original;
  }

  private flashSaved(item: any) {
    item.isEditing = false;
    item.justSaved = true;
    setTimeout(() => item.justSaved = false, 3000);
  }

  constructor(
    private participantService: ParticipantService,
    private router: Router,
    private route: ActivatedRoute
  ) {}

  ngOnInit() {
    const currentRole = typeof window !== 'undefined' ? localStorage.getItem('participant_role') : '';
    if (currentRole === 'organizer' || currentRole === 'admin') {
      this.activeTab = 't-id';
    }

    this.route.queryParams.subscribe(params => {
      if (this.isOrganizer) {
        this.activeTab = 't-id';
        return;
      }
      const tabParam = params['tab'];
      if (tabParam === 'identity' || tabParam === 'id') {
        this.activeTab = 't-id';
      } else if (tabParam === 'const' || tabParam === 'contraintes') {
        this.activeTab = 't-const';
      } else if (tabParam === 'pref' || tabParam === 'preferences') {
        this.activeTab = 't-pref';
      }
    });

    window.addEventListener('switch_profile_tab', (e: any) => {
      if (this.isOrganizer) {
        this.activeTab = 't-id';
        return;
      }
      if (e.detail?.tab) {
        this.activeTab = e.detail.tab;
      }
    });

    this.loadProfilePhoto();
    this.loadOrganizations();

    const id = localStorage.getItem('participant_id');
    if (!id) {
      this.router.navigate(['/participant-login']);
      return;
    }

    this.participantService.getParticipant(id).subscribe({
      next: (data) => {
        this.participant = data;
        if (this.isOrganizer) {
          this.activeTab = 't-id';
        }
        this.loadProfilePhoto();
        this.populateIdForm();
        if (data.preferences) this.savedPreferences = data.preferences;
        if (data.constraints) this.savedConstraints = data.constraints;
        this.ensureStandardItems();
        this.initScoreBonus();
      },
      error: () => {
        this.router.navigate(['/participant-login']);
      }
    });
  }

  loadOrganizations() {
    this.participantService.getOrganizations().subscribe({
      next: (orgs: any[]) => {
        if (Array.isArray(orgs)) {
          const names = orgs.map(o => o.name).filter(Boolean);
          this.availableOrganizations = ['Aucune', ...names];
        }
      }
    });
  }

  /** Garantit la présence de toutes les questions du quiz pour modification */
  private ensureStandardItems() {
    if (!this.participant?.id) return;

    const standardConstraints = [
      { type: 'Alimentaire', defaultVal: 'Je mange de tout', isHard: true },
      { type: 'Allergies', defaultVal: 'Aucune allergie', isHard: true },
      { type: 'Accessibilité', defaultVal: 'Aucun', isHard: true },
      { type: 'Transport', defaultVal: 'Train', isHard: true },
      { type: 'Budget (Max)', defaultVal: '100€ - 300€', isHard: true }
    ];

    standardConstraints.forEach(sc => {
      const found = this.savedConstraints.find(c => c.type === sc.type);
      if (!found) {
        this.participantService.addConstraint(this.participant.id, sc.type, sc.defaultVal, sc.isHard).subscribe({
          next: (res) => {
            this.savedConstraints.push({ id: res.id, type: sc.type, value: sc.defaultVal, isHard: sc.isHard, isEditing: false });
          }
        });
      }
    });

    const standardPreferences = [
      { type: 'Boisson', defaultVal: 'Café' },
      { type: 'Arrivée', defaultVal: 'Matin' },
      { type: 'Transfert', defaultVal: 'Non, je me débrouille' },
      { type: 'Hébergement', defaultVal: 'Hôtel standard' },
      { type: 'Partage Chambre', defaultVal: 'Non' },
      { type: 'Facturation', defaultVal: 'Pas de facture' },
      { type: 'Objectif', defaultVal: 'Apprendre' },
      { type: 'Format', defaultVal: 'Atelier Pratique' },
      { type: 'Niveau', defaultVal: 'Intermédiaire' },
      { type: 'Ambiance', defaultVal: 'Détendu et Informel' },
      { type: 'Espace', defaultVal: 'Pas besoin d\'espace calme' },
      { type: 'Afterwork', defaultVal: 'Oui, présent ! 🍻' },
      { type: 'Intérêt Tech', defaultVal: '5/10' },
      { type: 'Intérêt Social', defaultVal: '5/10' },
      { type: 'Intérêt Sport', defaultVal: '5/10' }
    ];

    standardPreferences.forEach(sp => {
      const found = this.savedPreferences.find(p => p.type === sp.type);
      if (!found) {
        this.participantService.addPreference(this.participant.id, sp.type, sp.defaultVal).subscribe({
          next: (res) => {
            this.savedPreferences.push({ id: res.id, type: sp.type, value: sp.defaultVal, isEditing: false });
          }
        });
      }
    });
  }

  getInitials(name: string): string {
    if (!name) return '';
    return name.split(' ').filter(Boolean).map(n => n[0]).join('').substring(0, 2).toUpperCase();
  }

  savePreference(type: string, value: string) {
    if (!value) return;
    this.participantService.addPreference(this.participant.id, type, value).subscribe({
      next: (res) => {
        this.savedPreferences.push({ id: res.id, type, value, isEditing: false });
      }
    });
  }

  updatePreference(pref: any) {
    if (!this.isChanged(pref)) { pref.isEditing = false; return; }
    this.participantService.updatePreference(pref.id, pref.value).subscribe({
      next: () => { this.flashSaved(pref); this.recomputeProfile(); }
    });
  }

  saveConstraint(type: string, value: string, isHard: boolean) {
    if (!value) return;
    this.participantService.addConstraint(this.participant.id, type, value, isHard).subscribe({
      next: (res) => {
        this.savedConstraints.push({ id: res.id, type, value, isHard, isEditing: false });
      }
    });
  }

  updateConstraint(constObj: any) {
    if (!this.isChanged(constObj)) { constObj.isEditing = false; return; }
    this.participantService.updateConstraint(constObj.id, constObj.value).subscribe({
      next: () => { this.flashSaved(constObj); this.recomputeProfile(); }
    });
  }

  loadProfilePhoto() {
    const id = this.participant?.id || localStorage.getItem('participant_id') || 'current';
    this.profilePhoto = this.participant?.photo || localStorage.getItem('participant_avatar_' + id) || localStorage.getItem('participant_avatar_current') || null;
  }

  triggerPhotoUpload(input: HTMLInputElement) {
    if (input) {
      input.click();
    }
  }

  onPhotoSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const fileName = file.name.toLowerCase();
      const fileType = file.type.toLowerCase();
      const validTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];

      if (!validTypes.includes(fileType) || fileType.includes('pdf') || fileName.endsWith('.pdf')) {
        this.photoErrorMsg = 'Format de fichier non supporté. Les PDF sont interdits, veuillez sélectionner une image (PNG, JPG ou WEBP).';
        input.value = '';
        setTimeout(() => this.photoErrorMsg = '', 5000);
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        this.photoErrorMsg = 'La photo dépasse la taille maximale autorisée (maximum 2 Mo).';
        input.value = '';
        setTimeout(() => this.photoErrorMsg = '', 5000);
        return;
      }
      this.photoErrorMsg = '';
      const reader = new FileReader();
      reader.onload = (e: any) => {
        const dataUrl = e.target.result as string;
        this.savePhoto(dataUrl);
      };
      reader.readAsDataURL(file);
    }
  }

  setPresetAvatar(url: string) {
    this.savePhoto(url);
  }

  savePhoto(photoData: string) {
    const id = this.participant?.id || localStorage.getItem('participant_id') || 'current';
    this.profilePhoto = photoData;
    if (this.participant) this.participant.photo = photoData;
    localStorage.setItem('participant_avatar_' + id, photoData);
    localStorage.setItem('participant_avatar_current', photoData);
    if (this.participant?.id) {
      this.participantService.updateProfile(this.participant.id, { photo: photoData }).subscribe();
    }
    window.dispatchEvent(new CustomEvent('profile_photo_updated', { detail: { photo: photoData } }));
    this.photoSuccessMsg = 'Avatar mis à jour et enregistré en base ! ✨';
    setTimeout(() => this.photoSuccessMsg = '', 3500);
  }

  removePhoto() {
    const id = this.participant?.id || localStorage.getItem('participant_id') || 'current';
    this.profilePhoto = null;
    if (this.participant) this.participant.photo = '';
    localStorage.removeItem('participant_avatar_' + id);
    localStorage.removeItem('participant_avatar_current');
    if (this.participant?.id) {
      this.participantService.updateProfile(this.participant.id, { photo: '' }).subscribe();
    }
    window.dispatchEvent(new CustomEvent('profile_photo_updated', { detail: { photo: null } }));
    this.photoSuccessMsg = 'Avatar retiré : affichage de vos initiales.';
    setTimeout(() => this.photoSuccessMsg = '', 3500);
  }

  onNameChange(field: 'first_name' | 'last_name') {
    const val = (this.idForm as any)[field];
    const isFirst = field === 'first_name';
    const label = isFirst ? 'le prénom' : 'le nom';

    if (!val || !val.trim()) {
      if (isFirst) this.firstNameErrorMsg = '';
      else this.lastNameErrorMsg = '';
      return;
    }

    // Contrôle strict : interdire les chiffres (0-9)
    if (/\d/.test(val)) {
      const msg = `Les chiffres ne sont pas autorisés dans ${label}. Seules les lettres sont acceptées.`;
      if (isFirst) this.firstNameErrorMsg = msg;
      else this.lastNameErrorMsg = msg;
      return;
    }

    // Contrôle strict : interdire les points (.)
    if (/\./.test(val)) {
      const msg = `Les points ne sont pas autorisés dans ${label}.`;
      if (isFirst) this.firstNameErrorMsg = msg;
      else this.lastNameErrorMsg = msg;
      return;
    }

    // Seules les lettres (majuscules, minuscules, accents), apostrophes et tirets sont autorisés
    const validLettersRegex = /^[a-zA-ZÀ-ÿ\s'-]+$/;
    if (!validLettersRegex.test(val)) {
      const msg = `Seules les lettres (majuscules et minuscules) sont autorisées.`;
      if (isFirst) this.firstNameErrorMsg = msg;
      else this.lastNameErrorMsg = msg;
      return;
    }

    if (isFirst) this.firstNameErrorMsg = '';
    else this.lastNameErrorMsg = '';
  }

  onPhoneChange() {
    const val = this.idForm.phone;
    if (!val || !val.trim()) {
      this.phoneErrorMsg = '';
      return;
    }

    const clean = val.trim();
    // Interdire les lettres et caractères autres que chiffres, +, espaces et tirets
    if (/[^0-9\s.+-]/.test(clean)) {
      this.phoneErrorMsg = 'Uniquement des chiffres autorisés pour le numéro.';
      return;
    }

    const digitsOnly = clean.replace(/\D/g, '');

    if (clean.startsWith('+33') || clean.startsWith('0033')) {
      const digitsAfterPrefix = clean.startsWith('+33')
        ? digitsOnly.substring(2)
        : digitsOnly.substring(4);
      const count = digitsAfterPrefix.length;
      if (count < 9) {
        this.phoneErrorMsg = `Numéro incomplet : exactement 9 chiffres requis après +33 (${count}/9).`;
      } else if (count > 9) {
        this.phoneErrorMsg = `Numéro trop long : exactement 9 chiffres requis après +33 (${count}/9).`;
      } else if (!/^[1-9]/.test(digitsAfterPrefix)) {
        this.phoneErrorMsg = 'Le premier chiffre après +33 doit être entre 1 et 9 (ex: +33 6...).';
      } else {
        this.phoneErrorMsg = '';
      }
    } else if (clean.startsWith('0')) {
      const count = digitsOnly.length;
      if (count < 10) {
        this.phoneErrorMsg = `Numéro incomplet : exactement 10 chiffres requis (${count}/10).`;
      } else if (count > 10) {
        this.phoneErrorMsg = `Numéro trop long : exactement 10 chiffres requis (${count}/10).`;
      } else if (!/^0[1-9]/.test(digitsOnly)) {
        this.phoneErrorMsg = 'Le numéro français doit commencer par 01, 02, 03, 04, 05, 06, 07 ou 09.';
      } else {
        this.phoneErrorMsg = '';
      }
    } else {
      this.phoneErrorMsg = 'Le numéro français doit comporter exactement 10 chiffres (débutant par 0) ou 9 chiffres avec +33.';
    }
  }

  startEditId(field: string) {
    this.editingId[field] = true;
    if (field === 'phone') {
      this.onPhoneChange();
    }
    if (field === 'first_name') {
      this.onNameChange('first_name');
    }
    if (field === 'last_name') {
      this.onNameChange('last_name');
    }
  }

  cancelEditId(field: string) {
    this.editingId[field] = false;
    if (field === 'phone') this.phoneErrorMsg = '';
    if (field === 'email') this.emailErrorMsg = '';
    if (field === 'first_name') this.firstNameErrorMsg = '';
    if (field === 'last_name') this.lastNameErrorMsg = '';
    this.populateIdForm();
  }

  saveIdField(field: string) {
    if (!this.participant?.id) return;
    const val = (this.idForm as any)[field];

    if (field === 'first_name') {
      this.onNameChange('first_name');
      if (this.firstNameErrorMsg) return;
      if (!val || !val.trim()) {
        this.firstNameErrorMsg = 'Le prénom ne peut pas être vide.';
        return;
      }
    }

    if (field === 'last_name') {
      this.onNameChange('last_name');
      if (this.lastNameErrorMsg) return;
      if (!val || !val.trim()) {
        this.lastNameErrorMsg = 'Le nom ne peut pas être vide.';
        return;
      }
    }

    if (field === 'phone') {
      this.onPhoneChange();
      if (this.phoneErrorMsg) {
        return;
      }
    }

    if (field === 'email') {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!val || !val.trim() || !emailRegex.test(val.trim())) {
        this.emailErrorMsg = 'Veuillez saisir une adresse e-mail valide (ex: nom@domaine.com).';
        return;
      }
      this.emailErrorMsg = '';
    }

    const payload: any = { [field]: val };

    this.participantService.updateProfile(this.participant.id, payload).subscribe({
      next: (res) => {
        this.editingId[field] = false;
        this.applyIdUpdate(field, val, res);
      },
      error: () => {
        this.editingId[field] = false;
        this.applyIdUpdate(field, val);
      }
    });
  }

  private applyIdUpdate(field: string, val: string, res?: any) {
    if (field === 'first_name') {
      this.participant.first_name = val;
      const ln = this.idForm.last_name || this.participant.last_name || '';
      this.participant.full_name = res?.full_name || `${val} ${ln}`.trim();
      localStorage.setItem('participant_name', this.participant.full_name);
      window.dispatchEvent(new CustomEvent('profile_name_updated', { detail: { name: this.participant.full_name } }));
    } else if (field === 'last_name') {
      this.participant.last_name = val;
      const fn = this.idForm.first_name || this.participant.first_name || '';
      this.participant.full_name = res?.full_name || `${fn} ${val}`.trim();
      localStorage.setItem('participant_name', this.participant.full_name);
      window.dispatchEvent(new CustomEvent('profile_name_updated', { detail: { name: this.participant.full_name } }));
    } else if (field === 'email') {
      this.participant.email = val;
    } else if (field === 'phone') {
      this.participant.phone = val;
      localStorage.setItem('participant_phone_' + this.participant.id, val);
    } else if (field === 'organization') {
      if (!this.participant.organization) this.participant.organization = {};
      this.participant.organization.name = val;
      this.participant.organization_name = val;
      localStorage.setItem('participant_org_' + this.participant.id, val);
    }
    this.idSuccessMsg = 'Information enregistrée avec succès dans la base de données ! ✨';
    setTimeout(() => this.idSuccessMsg = '', 3500);
  }

  populateIdForm() {
    if (!this.participant) return;
    this.idForm.first_name = this.participant.first_name || '';
    this.idForm.last_name = this.participant.last_name || '';
    if (!this.idForm.first_name && !this.idForm.last_name && this.participant.full_name) {
      const parts = this.participant.full_name.trim().split(' ');
      this.idForm.first_name = parts[0] || '';
      this.idForm.last_name = parts.slice(1).join(' ') || '';
    }
    this.idForm.email = this.participant.email || '';
    this.idForm.phone = this.participant.phone || localStorage.getItem('participant_phone_' + this.participant.id) || '';
    const orgVal = this.participant.organization_name || this.participant.organization?.name || localStorage.getItem('participant_org_' + this.participant.id) || 'Aucune';
    this.idForm.organization = orgVal;
    if (orgVal && !this.availableOrganizations.includes(orgVal)) {
      this.availableOrganizations.push(orgVal);
    }
  }

  deleteAccount() {
    if (confirm('Voulez-vous vraiment supprimer votre compte ? Cette action est irréversible.')) {
      this.participantService.deleteParticipant(this.participant.id).subscribe({
        next: () => {
          localStorage.removeItem('participant_id');
          localStorage.removeItem('participant_role');
          localStorage.removeItem('participant_name');
          localStorage.removeItem('participant_score');
          this.router.navigate(['/']);
        }
      });
    }
  }
}
