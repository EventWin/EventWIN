/**
 * Fonctions de base de contrôle de saisie (réutilisables dans tous les formulaires).
 * Chaque fonction retourne un message d'erreur (string) ou '' si la valeur est valide.
 */

const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const NAME_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ]+(?:[ '\-][A-Za-zÀ-ÖØ-öø-ÿ]+)*$/;

/** Champ obligatoire. */
export function required(value: string | null | undefined, label = 'Ce champ'): string {
  return (value ?? '').trim() ? '' : `${label} est obligatoire.`;
}

/** Adresse e-mail valide. */
export function validateEmail(value: string): string {
  const v = (value ?? '').trim();
  if (!v) return "L'adresse e-mail est obligatoire.";
  if (v.length > 254 || !EMAIL_REGEX.test(v)) return "Format d'e-mail invalide (ex : nom@entreprise.com).";
  return '';
}

/** Nom complet : 2 à 60 caractères, lettres, espaces, apostrophes et tirets. */
export function validateFullName(value: string): string {
  const v = (value ?? '').trim();
  if (!v) return 'Le nom complet est obligatoire.';
  if (v.length < 2) return 'Le nom doit contenir au moins 2 caractères.';
  if (v.length > 60) return 'Le nom ne doit pas dépasser 60 caractères.';
  if (!NAME_REGEX.test(v)) return 'Le nom ne peut contenir que des lettres, espaces, apostrophes et tirets.';
  return '';
}

/** Mot de passe d'inscription : 8+ caractères, majuscule, minuscule, chiffre. */
export function validatePassword(value: string): string {
  const v = value ?? '';
  if (!v) return 'Le mot de passe est obligatoire.';
  if (v.length < 8) return 'Au moins 8 caractères.';
  if (v.length > 64) return 'Maximum 64 caractères.';
  if (!/[a-z]/.test(v)) return 'Ajoutez une lettre minuscule.';
  if (!/[A-Z]/.test(v)) return 'Ajoutez une lettre majuscule.';
  if (!/\d/.test(v)) return 'Ajoutez un chiffre.';
  if (/\s/.test(v)) return "Le mot de passe ne doit pas contenir d'espace.";
  return '';
}

/** Mot de passe de connexion : simplement non vide. */
export function validateLoginPassword(value: string): string {
  return (value ?? '') ? '' : 'Le mot de passe est obligatoire.';
}

/** Force du mot de passe de 0 (vide) à 4 (très robuste). */
export function passwordStrength(value: string): number {
  const v = value ?? '';
  if (!v) return 0;
  let score = 0;
  if (v.length >= 8) score++;
  if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
  if (/\d/.test(v)) score++;
  if (/[^A-Za-z0-9]/.test(v) || v.length >= 12) score++;
  return score;
}

export function strengthLabel(score: number): string {
  return ['', 'Faible', 'Moyen', 'Bon', 'Excellent'][score] || '';
}

/** Confirmation identique au mot de passe. */
export function validateConfirm(password: string, confirm: string): string {
  if (!confirm) return 'Veuillez confirmer le mot de passe.';
  return password === confirm ? '' : 'Les mots de passe ne correspondent pas.';
}

/** Code OTP : exactement 6 chiffres. */
export function validateOtp(value: string): string {
  const v = (value ?? '').trim();
  if (!v) return 'Le code de vérification est obligatoire.';
  return /^\d{6}$/.test(v) ? '' : 'Le code doit contenir exactement 6 chiffres.';
}
