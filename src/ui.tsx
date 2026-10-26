import React from 'react';
import { Text, View, Pressable, StyleSheet, StyleProp, ViewStyle, Platform } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
export const C = { bg: '#F6F5F0', paper: '#FFFFFF', ink: '#193D35', muted: '#6F7F77', green: '#236B51', mint: '#E5F0E8', lime: '#DCEEAF', line: '#E2E7DE', amber: '#FAEED4', danger: '#AF5144' };
export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export function Icon({name, size = 22, color = C.ink}: {name: IconName; size?: number; color?: string}) { return <Ionicons name={name} size={size} color={color}/>; }
export function T({children, style, ...props}: React.ComponentProps<typeof Text>) { return <Text {...props} style={[s.text, style]}>{children}</Text>; }
export function Card({children, style, disabled}: {children: React.ReactNode; style?: StyleProp<ViewStyle>; disabled?:boolean}) { return <View pointerEvents={disabled ? 'none' : 'auto'} style={[s.card, style, disabled && {opacity:0.45}]}>{children}</View>; }
export function Button({title, onPress, icon, secondary, disabled, danger, small}: {title: string; onPress: () => void; icon?: IconName; secondary?: boolean; disabled?: boolean; danger?: boolean; small?: boolean}) {
  const color = secondary ? danger ? C.danger : C.ink : '#fff';
  return <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress} style={({pressed}) => [s.button, secondary && s.secondary, small && {paddingVertical: 10}, danger && !secondary && {backgroundColor: C.danger}, {opacity: disabled ? 0.4 : pressed ? 0.7 : 1}]}>
    {icon && <Icon name={icon} size={19} color={color}/>}<T style={{color, fontWeight:'700', fontSize: small ? 13 : 15}}>{title}</T>
  </Pressable>;
}
export function Chips<K extends string>({options, value, onChange}: {options: Partial<Record<K, string>>; value: K; onChange: (key: K) => void}) {
  return <View style={s.chips}>{(Object.keys(options) as K[]).map(key => <Pressable key={key} accessibilityRole="radio" accessibilityState={{selected: value === key}} onPress={() => onChange(key)} style={[s.chip, value === key && s.chipSelected]}><T style={{fontSize: 13, color: value === key ? '#fff' : C.muted}}>{options[key]}</T></Pressable>)}</View>;
}
export const s = StyleSheet.create({
  text: {fontFamily: Platform.select({web:'Tahoma, Arial, sans-serif',android:'sans-serif',ios:'System'}), fontSize: 15, lineHeight: 25, color: C.ink, textAlign:'right'},
  title: {fontSize: 28, lineHeight: 43, fontWeight:'800'},
  subtitle: {fontSize: 19, lineHeight: 32, fontWeight:'700'},
  muted: {color:C.muted, fontSize:13, lineHeight:23},
  card: {padding:20, borderRadius:24, backgroundColor:C.paper, borderWidth:1, borderColor:C.line, gap:12},
  row: {flexDirection:'row-reverse', alignItems:'center', gap:10},
  between: {flexDirection:'row-reverse', justifyContent:'space-between', alignItems:'center', gap:12},
  button: {backgroundColor:C.green, paddingVertical:15, paddingHorizontal:18, borderRadius:16, flexDirection:'row-reverse', alignItems:'center', justifyContent:'center', gap:9, minHeight:44},
  secondary: {backgroundColor:C.mint},
  chips: {flexDirection:'row-reverse', flexWrap:'wrap', gap:8},
  chip: {paddingVertical:9, paddingHorizontal:14, borderRadius:13, borderWidth:1, borderColor:C.line, backgroundColor:C.bg, minHeight:44, justifyContent:'center'},
  chipSelected: {backgroundColor:C.green, borderColor:C.green},
  input: {fontFamily:Platform.select({web:'Tahoma, Arial, sans-serif',android:'sans-serif',ios:'System'}), borderWidth:1, borderColor:C.line, borderRadius:14, padding:14, backgroundColor:'#FAFBF8', textAlign:'right', color:C.ink, fontSize:15, minHeight:49},
  badge: {alignSelf:'flex-end', backgroundColor:C.mint, paddingVertical:4, paddingHorizontal:10, borderRadius:8},
  divider: {height:1, backgroundColor:C.line, marginVertical:4},
});
