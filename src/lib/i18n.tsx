/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { SafeStorage } from './safeStorage';

export type Locale = 'en' | 'sn' | 'nd';

const translations: Record<Locale, Record<string, string>> = {
  en: {
    // Common
    'app.name': 'PickMe',
    'common.back': 'Back',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.loading': 'Loading...',
    'common.error': 'Error',
    'common.success': 'Success',
    'common.search': 'Search',
    'common.done': 'Done',
    'common.close': 'Close',
    // Nav
    'nav.ride': 'Ride',
    'nav.drive': 'Drive',
    'nav.business': 'Business',
    'nav.about': 'About',
    'nav.help': 'Help',
    'nav.login': 'Log in',
    'nav.signup': 'Sign up',
    'nav.profile': 'Profile',
    'nav.wallet': 'Wallet',
    'nav.history': 'History',
    'nav.home': 'Home',
    'nav.settings': 'Settings',
    // Ride
    'ride.pickup': 'Pick-up location',
    'ride.dropoff': 'Drop-off location',
    'ride.request': 'Request Ride',
    'ride.fare': 'Fare',
    'ride.distance': 'Distance',
    'ride.duration': 'Duration',
    'ride.status': 'Status',
    'ride.completed': 'Completed',
    'ride.cancelled': 'Cancelled',
    'ride.pending': 'Pending',
    'ride.noRides': 'No rides yet',
    'ride.history': 'My Trips',
    'ride.bookAgain': 'Book Again',
    'ride.emergency': 'Emergency SOS',
    // Driver
    'driver.earnings': 'Earnings',
    'driver.trips': 'Trips',
    'driver.rating': 'Rating',
    'driver.online': 'Online',
    'driver.offline': 'Offline',
    'driver.leaderboard': 'Top Drivers',
    'driver.rank': 'Rank',
    // Wallet
    'wallet.balance': 'Balance',
    'wallet.deposit': 'Deposit',
    'wallet.withdraw': 'Withdraw',
    'wallet.transactions': 'Transactions',
    // Analytics
    'analytics.spending': 'Spending Trends',
    'analytics.thisWeek': 'This Week',
    'analytics.thisMonth': 'This Month',
    'analytics.totalSpent': 'Total Spent',
    'analytics.avgPerTrip': 'Avg per Trip',
    'analytics.totalTrips': 'Total Trips',
    'analytics.topRoute': 'Top Route',
    // Language
    'lang.en': 'English',
    'lang.sn': 'Shona',
    'lang.nd': 'Ndebele',
    'lang.select': 'Language',
  },
  sn: {
    'app.name': 'PickMe',
    'common.back': 'Dzoka',
    'common.save': 'Chengetedza',
    'common.cancel': 'Kanzura',
    'common.loading': 'Kurodhwa...',
    'common.error': 'Kukanganisa',
    'common.success': 'Zvabudirira',
    'common.search': 'Tsvaka',
    'common.done': 'Zvapera',
    'common.close': 'Vhara',
    'nav.ride': 'Famba',
    'nav.drive': 'Tyaira',
    'nav.business': 'Bhizinesi',
    'nav.about': 'Nezvedu',
    'nav.help': 'Rubatsiro',
    'nav.login': 'Pinda',
    'nav.signup': 'Nyoresa',
    'nav.profile': 'Pfaira',
    'nav.wallet': 'Chikwama',
    'nav.history': 'Nhoroondo',
    'nav.home': 'Kumba',
    'nav.settings': 'Zvirongwa',
    'ride.pickup': 'Nzvimbo yekutora',
    'ride.dropoff': 'Nzvimbo yekudzika',
    'ride.request': 'Kumbira Kufamba',
    'ride.fare': 'Mutengo',
    'ride.distance': 'Chinhambwe',
    'ride.duration': 'Nguva',
    'ride.status': 'Mamiriro',
    'ride.completed': 'Yapera',
    'ride.cancelled': 'Yakanzurwa',
    'ride.pending': 'Yakamirira',
    'ride.noRides': 'Hapana rwendo',
    'ride.history': 'Nzendo Dzangu',
    'ride.bookAgain': 'Bhuka Zvakare',
    'ride.emergency': 'Njodzi SOS',
    'driver.earnings': 'Mari',
    'driver.trips': 'Nzendo',
    'driver.rating': 'Marenki',
    'driver.online': 'Panyaya',
    'driver.offline': 'Hausi panyaya',
    'driver.leaderboard': 'Vatyairi Vepamberi',
    'driver.rank': 'Chinzvimbo',
    'wallet.balance': 'Bhaaranzi',
    'wallet.deposit': 'Dhipoziti',
    'wallet.withdraw': 'Bvisa',
    'wallet.transactions': 'Zvakaitika',
    'analytics.spending': 'Mashandisiro eMari',
    'analytics.thisWeek': 'Svondo Rino',
    'analytics.thisMonth': 'Mwedzi Uno',
    'analytics.totalSpent': 'Yakashandiswa',
    'analytics.avgPerTrip': 'Pane Rwendo',
    'analytics.totalTrips': 'Nzendo Dzose',
    'analytics.topRoute': 'Nzira Huru',
    'lang.en': 'Chirungu',
    'lang.sn': 'Shona',
    'lang.nd': 'IsiNdebele',
    'lang.select': 'Mutauro',
  },
  nd: {
    'app.name': 'PickMe',
    'common.back': 'Buyela',
    'common.save': 'Gcina',
    'common.cancel': 'Susa',
    'common.loading': 'Kuyalodwa...',
    'common.error': 'Iphutha',
    'common.success': 'Kuphumelele',
    'common.search': 'Dinga',
    'common.done': 'Kuqedile',
    'common.close': 'Vala',
    'nav.ride': 'Hamba',
    'nav.drive': 'Tshayela',
    'nav.business': 'Ibhizinesi',
    'nav.about': 'Ngathi',
    'nav.help': 'Uncedo',
    'nav.login': 'Ngena',
    'nav.signup': 'Bhalisa',
    'nav.profile': 'Iphrofayili',
    'nav.wallet': 'Isikhwama',
    'nav.history': 'Imbali',
    'nav.home': 'Ekhaya',
    'nav.settings': 'Izilungiselelo',
    'ride.pickup': 'Indawo yokuthatha',
    'ride.dropoff': 'Indawo yokwehlisa',
    'ride.request': 'Cela Uhambo',
    'ride.fare': 'Intengo',
    'ride.distance': 'Ibanga',
    'ride.duration': 'Isikhathi',
    'ride.status': 'Isimo',
    'ride.completed': 'Kuqedile',
    'ride.cancelled': 'Kususiwe',
    'ride.pending': 'Kulindile',
    'ride.noRides': 'Kakho uhambo',
    'ride.history': 'Uhambo Lwami',
    'ride.bookAgain': 'Bhuka Futhi',
    'ride.emergency': 'Ingozi SOS',
    'driver.earnings': 'Imali',
    'driver.trips': 'Uhambo',
    'driver.rating': 'Izinga',
    'driver.online': 'Ku-inthanethi',
    'driver.offline': 'Awukho ku-inthanethi',
    'driver.leaderboard': 'Abatshayeli Abaphezulu',
    'driver.rank': 'Isikhundla',
    'wallet.balance': 'Ibhalansi',
    'wallet.deposit': 'Idhiphozithi',
    'wallet.withdraw': 'Khipha',
    'wallet.transactions': 'Okwenzekileyo',
    'analytics.spending': 'Ukusebenzisa Imali',
    'analytics.thisWeek': 'Leviki',
    'analytics.thisMonth': 'Lenyanga',
    'analytics.totalSpent': 'Okusetshenzisiweyo',
    'analytics.avgPerTrip': 'Ngohambo',
    'analytics.totalTrips': 'Uhambo Lonke',
    'analytics.topRoute': 'Indlela Ephezulu',
    'lang.en': 'English',
    'lang.sn': 'Shona',
    'lang.nd': 'IsiNdebele',
    'lang.select': 'Ulimi',
  },
};

const LOCALE_LABELS: Record<Locale, string> = { en: 'EN', sn: 'SN', nd: 'ND' };

interface I18nContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
  locales: Locale[];
  localeLabel: (l: Locale) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = SafeStorage.get('pickme-locale');
    return (saved as Locale) || 'en';
  });

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    SafeStorage.set('pickme-locale', l);
  }, []);

  const t = useCallback(
    (key: string) => translations[locale]?.[key] ?? translations.en[key] ?? key,
    [locale]
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, locales: ['en', 'sn', 'nd'], localeLabel: (l) => LOCALE_LABELS[l] }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
