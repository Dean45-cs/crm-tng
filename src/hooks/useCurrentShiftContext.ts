import { useMemo } from 'react';
import { useShifts } from '../store/useShifts';
import { useStore } from '../store/useStore';
import type { Campaign, CampaignCallType, ShiftType } from '../types';

/**
 * Der „aktuelle Betriebskontext" des eingeloggten Users als eine abgeleitete,
 * live gehaltene Quelle: heutige Schicht → zugeordnete Kampagne → Call-Typ.
 *
 * Genau dieselbe Ableitung, die die Extension in fetchCurrentShift() macht —
 * damit CRM-Oberflächen (Dashboard-Badge etc.) und Extension nicht getrennt
 * raten, sondern denselben Zustand zeigen. Speist sich aus useShifts.todayShift
 * (via Realtime aktuell) und dem bereits geladenen Kampagnen-Katalog aus
 * useStore — keine eigenen Fetches.
 */
export interface CurrentShiftContext {
  /** Schichtart heute, oder null wenn keine Schicht eingetragen ist. */
  shiftType: ShiftType | null;
  /** true bei einer Arbeitsschicht (früh/spät), false bei frei/keiner Schicht. */
  working: boolean;
  campaignId: string | null;
  campaignName: string | null;
  /** Bestimmt Skript/Einwandkarten — nur gesetzt, wenn eine Kampagne zugeordnet ist. */
  callType: CampaignCallType | null;
  campaign: Campaign | null;
}

export function useCurrentShiftContext(): CurrentShiftContext {
  const todayShift = useShifts((s) => s.todayShift);
  const campaigns = useStore((s) => s.campaigns);

  return useMemo(() => {
    if (!todayShift || todayShift.shiftType === 'frei') {
      return {
        shiftType: todayShift?.shiftType ?? null,
        working: false,
        campaignId: null,
        campaignName: null,
        callType: null,
        campaign: null,
      };
    }
    const campaign = todayShift.campaignId
      ? campaigns.find((c) => c.id === todayShift.campaignId) ?? null
      : null;
    return {
      shiftType: todayShift.shiftType,
      working: true,
      campaignId: todayShift.campaignId ?? null,
      campaignName: campaign?.name ?? null,
      callType: campaign?.callType ?? null,
      campaign,
    };
  }, [todayShift, campaigns]);
}
