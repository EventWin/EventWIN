import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

const ICONS: Record<string, string> = {
  lieu: '<path d="M3 21h18M5 21V8l7-5 7 5v13M10 21v-6h4v6"/>',
  transport: '<path d="M4 16V7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9M4 16h16M4 16v3h3v-3M17 16v3h3v-3M7 9h10"/><circle cx="8" cy="12.5" r="1"/><circle cx="16" cy="12.5" r="1"/>',
  hebergement: '<path d="M3 18V6M3 12h13a4 4 0 0 1 4 4v2M3 18h18"/><circle cx="7.5" cy="9" r="1.8"/>',
  repas: '<path d="M5 3v8a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3M7 13v8M15 3c-1.5 1-2 3-2 5s.5 3 2 3v10"/>',
  activite: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>'
};

const POSTES = [
  { id: "lieu", label: "Lieu et salles", sub: "où l'événement se déroule", icon: "lieu", perDay: true, options: [
    { n: "Salle municipale", d: "Fonctionnelle, hors du centre", c: 14, s: 52 },
    { n: "Hôtel de séminaire", d: "Confortable, bien desservi", c: 28, s: 78 },
    { n: "Domaine privatisé", d: "Cadre remarquable, exclusif", c: 46, s: 94 }
  ]},
  { id: "transport", label: "Transport", sub: "comment vos participants arrivent", icon: "transport", perDay: false, options: [
    { n: "Chacun s'organise", d: "Aucun frais, retards probables", c: 0, s: 44 },
    { n: "Navettes groupées", d: "3 points de collecte coordonnés", c: 38, s: 80 },
    { n: "Car porte-à-porte", d: "Pris en charge de bout en bout", c: 74, s: 88 }
  ]},
  { id: "hebergement", label: "Hébergement", sub: "où ils dorment", icon: "hebergement", perDay: true, options: [
    { n: "Sans nuitée", d: "Événement en journée seulement", c: 0, s: 48 },
    { n: "Hôtel 3 étoiles", d: "Chambres doubles, petit-déjeuner", c: 72, s: 76 },
    { n: "Hôtel 4 étoiles", d: "Chambres individuelles, spa", c: 118, s: 92 }
  ]},
  { id: "repas", label: "Restauration", sub: "ce qu'ils mangent", icon: "repas", perDay: true, options: [
    { n: "Buffet simple", d: "Plateaux-repas et pauses café", c: 24, s: 56 },
    { n: "Cocktail avec îlots", d: "Debout, favorise les échanges", c: 42, s: 84 },
    { n: "Dîner gastronomique", d: "Service à table, menu signature", c: 68, s: 90 }
  ]},
  { id: "activite", label: "Activités", sub: "ce qu'ils vivent ensemble", icon: "activite", perDay: false, options: [
    { n: "Ateliers internes", d: "Animés par vos équipes", c: 9, s: 50 },
    { n: "Team building animé", d: "Intervenant externe, format éprouvé", c: 34, s: 82 },
    { n: "Expérience sur-mesure", d: "Scénarisée pour votre groupe", c: 62, s: 95 }
  ]}
];

const BASE = { lieu: 1, transport: 1, hebergement: 1, repas: 1, activite: 1 };
const PRIO: any = {
  conviv: { repas: 1.9, activite: 1.7, lieu: 1.1 },
  confort: { hebergement: 1.9, transport: 1.7, lieu: 1.3 },
  contenu: { activite: 1.6, lieu: 1.5, repas: .9 },
  eco: { transport: 1.8, lieu: 1.2, hebergement: .9 }
};

@Component({
  selector: 'app-optim',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './optim.component.html'
})
export class OptimComponent implements OnInit {
  Math = Math;
  step = 1;
  POSTES = POSTES;
  
  S = {
    people: 80,
    days: 2,
    budget: 40000,
    prio: ['conviv', 'confort'],
    choice: { ...BASE } as any,
    start: null as any
  };

  currentResult = { total: 0, score: 0 };
  startResult = { total: 0, score: 0 };
  
  tips: any[] = [];

  constructor(private sanitizer: DomSanitizer) {}

  ngOnInit() {
    this.calculate();
  }

  getIcon(iconName: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(ICONS[iconName]);
  }

  eur(n: number) {
    return Math.round(n).toLocaleString("fr-FR") + " €";
  }

  togglePrio(p: string) {
    const idx = this.S.prio.indexOf(p);
    if (idx >= 0) {
      if (this.S.prio.length > 1) {
        this.S.prio.splice(idx, 1);
      }
    } else {
      if (this.S.prio.length < 2) {
        this.S.prio.push(p);
      }
    }
    this.calculate();
  }

  hasPrio(p: string) {
    return this.S.prio.includes(p);
  }

  onPeopleChange(e: any) {
    this.S.people = +e.target.value;
    this.calculate();
  }

  onDaysChange(e: any) {
    this.S.days = +e.target.value;
    this.calculate();
  }

  onBudgetChange(e: any) {
    const v = e.target.value.replace(/[^\\d]/g, "");
    this.S.budget = Math.max(1, +v || 0);
    e.target.value = this.S.budget.toLocaleString("fr-FR");
    this.calculate();
  }

  goToStep(n: number) {
    if (n === 2 && this.step === 1) {
      this.S.start = { ...this.S.choice };
      this.startResult = this.evaluate(this.S.start);
    }
    this.step = n;
    if (n === 2) {
      this.calculate();
    }
  }

  selectOption(posteId: string, optionIndex: number) {
    this.S.choice[posteId] = optionIndex;
    this.calculate();
  }

  getCostOf(poste: any, optionIndex: number) {
    return poste.options[optionIndex].c * this.S.people * (poste.perDay ? this.S.days : 1);
  }

  weights() {
    const w: any = { ...BASE };
    this.S.prio.forEach(p => {
      const m = PRIO[p] || {};
      for (const k in m) w[k] = (w[k] || 1) * m[k];
    });
    return w;
  }

  evaluate(choice: any) {
    let t = 0, num = 0, den = 0;
    const w = this.weights();
    
    POSTES.forEach(p => {
      const i = choice[p.id];
      t += this.getCostOf(p, i);
      num += p.options[i].s * w[p.id];
      den += w[p.id];
    });
    
    return { total: t, score: Math.round(num / den) };
  }

  calculate() {
    this.currentResult = this.evaluate(this.S.choice);
    this.buildTips();
  }

  buildTips() {
    const cur = this.currentResult;
    const list: any[] = [];
    
    POSTES.forEach(p => {
      const i = this.S.choice[p.id];
      p.options.forEach((_, j) => {
        if (j === i) return;
        const alt = { ...this.S.choice };
        alt[p.id] = j;
        const r = this.evaluate(alt);
        const dC = r.total - cur.total;
        const dS = r.score - cur.score;
        
        if (dC < -150 && dS >= -3) {
          list.push({ p, j, dC, dS, kind: "eco", opt: p.options[j] });
        } else if (dS >= 4 && r.total <= this.S.budget && dC > 0) {
          list.push({ p, j, dC, dS, kind: "up", opt: p.options[j] });
        }
      });
    });
    
    list.sort((a, b) => (b.dS * 260 - b.dC) - (a.dS * 260 - a.dC));
    this.tips = list.slice(0, 3);
  }

  applyTip(t: any) {
    this.S.choice[t.p.id] = t.j;
    this.calculate();
  }

  autopt() {
    let best: any = null;
    const POSTES_LEN = POSTES.length;
    
    const rec = (k: number, acc: any) => {
      if (k === POSTES_LEN) {
        const r = this.evaluate(acc);
        if (r.total <= this.S.budget && (!best || r.score > best.score || (r.score === best.score && r.total < best.total))) {
          best = { ...r, choice: { ...acc } };
        }
        return;
      }
      const p = POSTES[k];
      p.options.forEach((_, i) => {
        acc[p.id] = i;
        rec(k + 1, acc);
      });
    };
    
    rec(0, {});
    
    if (best) {
      this.S.choice = best.choice;
      this.calculate();
    }
  }

  reset() {
    this.S.choice = { ...this.S.start };
    this.calculate();
  }
}
