import React from 'react';
import { StyleSheet, Text, View, ScrollView, Platform, TouchableOpacity, Image, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useQueue } from '@/contexts/QueueContext';
import { EmptyState } from '@/components/EmptyState';
import { Card } from '@/components/Card';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { useClerk } from '@clerk/expo';

export default function QueueScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { queue, removeFinding, clearQueue, retryFinding, replaceFindingPhoto, syncAll } = useQueue();
  const { signOut } = useClerk();
  const [cameraPermission, requestCameraPermission] = ImagePicker.useCameraPermissions();

  const handleDelete = (id: string) => {
    if (Platform.OS === 'web') {
      if (confirm('Delete this draft finding?')) {
        removeFinding(id);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    } else {
      Alert.alert(
        'Delete Draft',
        'Are you sure you want to remove this finding from your device queue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Delete', 
            style: 'destructive', 
            onPress: () => {
              removeFinding(id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            }
          }
        ]
      );
    }
  };

  const handleClearAll = () => {
    if (Platform.OS === 'web') {
      if (confirm('Clear all local findings? This cannot be undone.')) {
        clearQueue();
      }
    } else {
      Alert.alert(
        'Clear Queue',
        'Are you sure you want to delete all findings from your device? This cannot be undone.',
        [
          { text: 'Cancel', style: 'cancel' },
          { 
            text: 'Clear All', 
            style: 'destructive', 
            onPress: () => clearQueue()
          }
        ]
      );
    }
  };

  const handleRetry = async (id: string) => {
    try {
      await retryFinding(id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handleReplacePhoto = async (id: string) => {
    try {
      let permission = cameraPermission;
      if (!permission?.granted && permission?.canAskAgain) {
        permission = await requestCameraPermission();
      }
      if (!permission?.granted) {
        if (Platform.OS === 'web') {
          Alert.alert('Camera access required', 'Allow camera access in your browser settings, then try again.');
        } else {
          Alert.alert(
            'Camera access required',
            'Allow camera access in Settings to capture a replacement photo.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => void Linking.openSettings() },
            ],
          );
        }
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.5,
      });
      if (result.canceled || !result.assets[0]?.uri) return;
      await replaceFindingPhoto(id, result.assets[0].uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Could not replace photo', 'The replacement photo could not be saved. Try again.');
    }
  };

  if (queue.length === 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 84 : 44) }]}>
        <EmptyState 
          icon="check-circle"
          title="Queue is Empty"
          description="Captured evidence and findings will appear here before syncing to the cloud."
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 84 : 44) }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Local Queue</Text>
             <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
               {queue.length} / 5 items • Local evidence queue
            </Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity testID="clear-all-btn" onPress={handleClearAll} style={styles.clearBtn}>
              <Text style={[styles.clearText, { color: colors.destructive }]}>Clear All</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="sync-all-btn"
              onPress={() => void syncAll()}
              style={[styles.syncAllBtn, { backgroundColor: colors.primary }]}
            >
              <Feather name="upload-cloud" size={14} color={colors.primaryForeground} />
              <Text style={[styles.syncAllText, { color: colors.primaryForeground }]}>Sync ready</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="field-sign-out-btn"
              onPress={() => signOut()}
              style={[styles.signOutBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.signOutText, { color: colors.foreground }]}>Sign out</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.notice, { backgroundColor: colors.accent + '15', borderColor: colors.accent + '30' }]}>
          <Feather name="info" size={16} color={colors.accent} style={{ marginTop: 2 }} />
          <Text style={[styles.noticeText, { color: colors.foreground }]}>
              Photos keep their classification, checksum, and upload progress on this device. Unfinished uploads resume once connectivity returns, and manual retry remains available.
          </Text>
        </View>

        <View style={styles.list}>
          {queue.map((item) => (
            <Card key={item.id} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <View style={styles.inspectionBadge}>
                  <Feather name="clipboard" size={12} color={colors.mutedForeground} />
                  <Text style={[styles.inspectionText, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {item.inspectionTitle}
                  </Text>
                </View>
                <TouchableOpacity 
                  testID={`delete-finding-${item.id}`}
                  onPress={() => handleDelete(item.id)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Feather name="trash-2" size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              <View style={styles.itemContent}>
                {item.localFileState === 'missing' ? (
                  <View style={[styles.thumbnail, styles.missingThumbnail, { borderRadius: colors.radius - 4, backgroundColor: colors.muted }]}>
                    <Feather name="image" size={24} color={colors.destructive} />
                  </View>
                ) : (
                  <Image source={{ uri: item.imageUri }} style={[styles.thumbnail, { borderRadius: colors.radius - 4 }]} />
                )}
                <View style={styles.itemDetails}>
                  <Text style={[styles.findingTitle, { color: colors.cardForeground }]} numberOfLines={2}>
                    {item.finding.label}
                  </Text>
                  <View style={styles.tags}>
                    <View style={[styles.tag, { backgroundColor: colors.muted }]}>
                      <Text style={[styles.tagText, { color: colors.mutedForeground }]}>
                        {item.finding.category}
                      </Text>
                    </View>
                    <View style={[styles.tag, { backgroundColor: item.classification === 'client_report' ? colors.primary + '20' : colors.accent + '20' }]}>
                      <Text style={[styles.tagText, { color: item.classification === 'client_report' ? colors.primary : colors.accent }]}>
                        {item.classification === 'client_report' ? 'Client report' : 'Private evidence'}
                      </Text>
                    </View>
                    <View style={[styles.tag, { backgroundColor: colors.muted }]}>
                      <Text style={[styles.tagText, { color: colors.mutedForeground }]}>
                        {item.finding.suggestedSeverity}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.timeText, { color: colors.mutedForeground }]}>
                    {new Date(item.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              </View>

               <View style={[styles.syncStatus, { borderTopColor: colors.border }]}>
                 <Feather
                   name={item.status === 'verified' ? 'check-circle' : item.status === 'failed' ? 'alert-circle' : item.status === 'uploading' ? 'upload-cloud' : 'cloud-off'}
                   size={14}
                   color={item.status === 'verified' ? colors.primary : item.status === 'failed' ? colors.destructive : colors.mutedForeground}
                 />
                 <View style={styles.syncCopy}>
                    <Text style={[styles.syncText, { color: item.status === 'failed' ? colors.destructive : colors.mutedForeground }]}>
                      {item.localFileState === 'missing'
                        ? 'Photo missing from this device'
                        : item.status === 'verified'
                       ? 'Verified in cloud'
                       : item.status === 'uploading'
                         ? `Uploading · ${item.progress}%`
                         : item.status === 'failed'
                           ? 'Upload interrupted'
                           : 'Ready for cloud upload'}
                   </Text>
                   {item.status !== 'verified' && item.progress > 0 && (
                     <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
                       <View style={[styles.progressFill, { backgroundColor: item.status === 'failed' ? colors.destructive : colors.primary, width: `${item.progress}%` }]} />
                     </View>
                   )}
                    {item.localFileState === 'missing' ? (
                      <Text style={[styles.errorText, { color: colors.destructive }]}>
                        Capture a replacement photo to keep this finding, its classification, and its upload progress.
                      </Text>
                    ) : item.lastError && item.status === 'failed' ? (
                      <Text style={[styles.errorText, { color: colors.destructive }]} numberOfLines={2}>{item.lastError}</Text>
                    ) : null}
                    {item.localFileState === 'missing' && item.lastError && (
                      <Text style={[styles.errorDetailText, { color: colors.mutedForeground }]} numberOfLines={2}>{item.lastError}</Text>
                   )}
                 </View>
                <View style={{ flex: 1 }} />
                 <Button
                    testID={item.localFileState === 'missing' ? `replace-photo-${item.id}` : `sync-finding-${item.id}`}
                    title={item.localFileState === 'missing' ? 'Replace photo' : item.status === 'verified' ? 'Synced' : item.status === 'failed' ? 'Retry' : item.status === 'uploading' ? 'Uploading' : 'Upload'}
                  variant="outline" 
                    onPress={() => void (item.localFileState === 'missing' ? handleReplacePhoto(item.id) : handleRetry(item.id))}
                  style={styles.syncBtn}
                  textStyle={styles.syncBtnText}
                    disabled={item.status === 'verified' || item.status === 'uploading'}
                />
              </View>
            </Card>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 120,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  headerActions: {
    alignItems: 'flex-end',
    gap: 4,
  },
  sectionTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    marginTop: 4,
  },
  clearBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  clearText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  signOutBtn: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  signOutText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  notice: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    gap: 12,
    marginBottom: 24,
  },
  noticeText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  list: {
    gap: 16,
  },
  itemCard: {
    padding: 0, // remove default padding to use full width sections
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  inspectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    paddingRight: 16,
  },
  inspectionText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
  },
  itemContent: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
  },
  thumbnail: {
    width: 80,
    height: 80,
    backgroundColor: '#eee',
  },
  missingThumbnail: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemDetails: {
    flex: 1,
    justifyContent: 'center',
  },
  findingTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    marginBottom: 8,
    lineHeight: 20,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  tagText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    textTransform: 'capitalize',
  },
  timeText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  syncStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    gap: 8,
  },
  syncText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
  },
  syncCopy: {
    minWidth: 0,
    flexShrink: 1,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 6,
    width: 140,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },
  errorText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 4,
  },
  errorDetailText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 4,
  },
  syncAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  syncAllText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
  syncBtn: {
    minHeight: 32,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  syncBtnText: {
    fontSize: 13,
  }
});
