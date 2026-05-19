/** App.tsx dagi `refreshAdminData` ni chaqirish (dashboard, savdo tarixi, qarzlar va h.k.). */

export const GEEKS_REFRESH_ADMIN_EVENT = 'geekspos-refresh-admin-data'



export type AdminRefreshDetail = {

  at: number

  reason?: string

  resolve?: () => void

}



/** Moliya/savdo o'zgargach admin ma'lumotlarini yangilash; Promise refresh tugaguncha kutadi. */

export function requestAdminDataRefresh(reason?: string): Promise<void> {

  return new Promise((resolve) => {

    window.dispatchEvent(

      new CustomEvent<AdminRefreshDetail>(GEEKS_REFRESH_ADMIN_EVENT, {

        detail: { at: Date.now(), reason, resolve },

      }),

    )

  })

}


