import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import colors from '../constants/colors';

export function useColors() {
  const scheme = useColorScheme();
  
  return useMemo(() => {
    const isDark = scheme === 'dark';
    return {
      ...(isDark ? colors.dark : colors.light),
      radius: colors.radius,
      isDark,
    };
  }, [scheme]);
}
