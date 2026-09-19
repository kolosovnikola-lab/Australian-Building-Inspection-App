import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';

export function Card({ children, style }: { children: React.ReactNode, style?: ViewStyle }) {
  const colors = useColors();
  return (
    <View style={[styles.card, { 
      backgroundColor: colors.card, 
      borderColor: colors.border, 
      borderRadius: colors.radius,
      shadowColor: colors.foreground,
    }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    overflow: 'hidden',
    padding: 16,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  }
});
