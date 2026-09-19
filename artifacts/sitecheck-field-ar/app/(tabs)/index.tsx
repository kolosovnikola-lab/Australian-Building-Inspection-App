import React, { useState } from 'react';
import { 
  StyleSheet, Text, View, ScrollView, Platform, 
  TouchableOpacity, Image, TextInput, KeyboardAvoidingView
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { 
  useListInspections, 
  useAnalyzeInspectionImage,
  Inspection,
  InspectionImageAnalysis,
  VisionFinding
} from '@workspace/api-client-react';
import { LoadingState } from '@/components/LoadingState';
import { ErrorState } from '@/components/ErrorState';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { AuthError, AuthNotice, AuthShell } from '@/components/AuthShell';
import { Card } from '@/components/Card';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import { Feather } from '@expo/vector-icons';
import { useQueue } from '@/contexts/QueueContext';
import { canSubmitFieldData } from '@/lib/account-security';
import { useAuth, useClerk } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

type Step = 'select_inspection' | 'capture' | 'analyze' | 'review';

export default function ScanScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addFinding } = useQueue();
  const { isSignedIn, getToken } = useAuth();
  const { signOut } = useClerk();
  const router = useRouter();
  
  const [step, setStep] = useState<Step>('select_inspection');
  const [selectedInspection, setSelectedInspection] = useState<Inspection | null>(null);
  const [capturedImage, setCapturedImage] = useState<{ uri: string; base64: string } | null>(null);
  const [area, setArea] = useState('');
  const [note, setNote] = useState('');
  const [classification, setClassification] = useState<'client_report' | 'private_evidence'>('client_report');
  
  const [analysisResult, setAnalysisResult] = useState<InspectionImageAnalysis | null>(null);
  const [selectedFindings, setSelectedFindings] = useState<Set<number>>(new Set());
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionRecoveryError, setSessionRecoveryError] = useState<string | null>(null);
  const [isReturningToSignIn, setIsReturningToSignIn] = useState(false);

  const { data: inspections, isLoading: loadingInspections, isError: errorInspections, refetch: refetchInspections } = useListInspections({ status: 'in_progress' });
  
  const analyzeMutation = useAnalyzeInspectionImage();
  const [permission, requestPermission] = ImagePicker.useCameraPermissions();

  const handleInspectionSelect = (inspection: Inspection) => {
    setSelectedInspection(inspection);
    setStep('capture');
  };

  const handleRequestPermission = async () => {
    if (!permission?.canAskAgain) {
      if (Platform.OS !== 'web') {
        Linking.openSettings();
      } else {
        alert('Please allow camera access in your browser settings.');
      }
      return;
    }
    await requestPermission();
  };

  const handleCapture = async () => {
    if (!permission?.granted) {
      await handleRequestPermission();
      return;
    }

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.5,
        base64: true,
      });

      if (!result.canceled && result.assets[0].base64) {
        setCapturedImage({
          uri: result.assets[0].uri,
          base64: result.assets[0].base64,
        });
      }
    } catch (e) {
      console.error('Camera error', e);
    }
  };

  const handleAnalyze = () => {
    if (!capturedImage?.base64) return;
    
    setStep('analyze');
    analyzeMutation.mutate(
      {
        data: {
          imageDataUrl: `data:image/jpeg;base64,${capturedImage.base64}`,
          area: area || undefined,
          inspectorNote: note || undefined,
        }
      },
      {
        onSuccess: (data) => {
          setAnalysisResult(data);
          setSelectedFindings(new Set(data.findings.map((_, i) => i))); // Select all by default
          setStep('review');
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        },
        onError: () => {
          // Stay on analyze to show error, or revert
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      }
    );
  };

  const toggleFindingSelection = (index: number) => {
    const next = new Set(selectedFindings);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setSelectedFindings(next);
    Haptics.selectionAsync();
  };

  const acceptFindings = async () => {
    if (!analysisResult || !selectedInspection || !capturedImage) return;

    let token: string | null = null;
    try {
      token = await getToken();
    } catch {
      token = null;
    }
    if (!canSubmitFieldData(Boolean(isSignedIn), token)) {
      setSessionRecoveryError(null);
      setSessionExpired(true);
      return;
    }
    
    const findingsToAdd = analysisResult.findings.filter((_, i) => selectedFindings.has(i));
    
    for (const finding of findingsToAdd) {
      await addFinding({
        inspectionId: selectedInspection.id,
        inspectionTitle: selectedInspection.title,
        imageUri: capturedImage.uri,
        finding,
        classification,
        area: area || undefined,
        note: note || undefined,
      });
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    
    // Reset for next capture
    setCapturedImage(null);
    setArea('');
    setNote('');
    setClassification('client_report');
    setAnalysisResult(null);
    setStep('capture');
  };

  const returnToSignIn = async () => {
    setSessionRecoveryError(null);
    setIsReturningToSignIn(true);
    try {
      await signOut();
      router.replace({
        pathname: '/(auth)/sign-in',
        params: { reason: 'session_expired' },
      });
    } catch (error) {
      setSessionRecoveryError(
        error instanceof Error
          ? error.message
          : 'Could not securely end the expired session. Try again.',
      );
    } finally {
      setIsReturningToSignIn(false);
    }
  };

  const renderSelectInspection = () => {
    if (loadingInspections) return <LoadingState message="Loading inspections..." />;
    if (errorInspections) return <ErrorState message="Could not load inspections" onRetry={refetchInspections} />;
    if (!inspections?.length) {
      return (
        <EmptyState 
          icon="clipboard" 
          title="No Active Inspections" 
          description="Start an inspection in the dashboard to begin capturing evidence." 
          action={<Button testID="refresh-inspections-btn" title="Refresh" onPress={() => refetchInspections()} variant="secondary" />}
        />
      );
    }

    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Select Inspection</Text>
        {inspections.map((insp) => (
          <TouchableOpacity 
            key={insp.id} 
            testID={`inspection-item-${insp.id}`}
            onPress={() => handleInspectionSelect(insp)}
            activeOpacity={0.7}
            style={{ marginBottom: 12 }}
          >
            <Card>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: colors.cardForeground }]}>{insp.title}</Text>
                <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
              </View>
              <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>{insp.propertyAddress}</Text>
            </Card>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  };

  const renderCapture = () => {
    if (!permission) {
      return <LoadingState />;
    }
    if (!permission.granted) {
      return (
        <EmptyState 
          icon="camera-off" 
          title="Camera Access Required" 
          description="We need your permission to capture evidence photos."
          action={
            <Button 
              testID="allow-camera-btn"
              title={permission.canAskAgain ? "Allow Camera" : "Open Settings"} 
              onPress={handleRequestPermission}
            />
          }
        />
      );
    }

    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => setStep('select_inspection')} style={styles.backButton}>
              <Feather name="arrow-left" size={24} color={colors.foreground} />
            </TouchableOpacity>
            <View>
              <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>ACTIVE INSPECTION</Text>
              <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 2, marginBottom: 0 }]}>
                {selectedInspection?.title}
              </Text>
            </View>
          </View>

          {capturedImage ? (
            <View style={styles.previewContainer}>
              <Image source={{ uri: capturedImage.uri }} style={[styles.previewImage, { borderRadius: colors.radius }]} />
              <TouchableOpacity 
                testID="retake-photo-btn"
                style={[styles.retakeBtn, { backgroundColor: colors.background }]}
                onPress={() => setCapturedImage(null)}
              >
                <Feather name="x" size={20} color={colors.foreground} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity 
              testID="capture-photo-btn"
              style={[styles.cameraPlaceholder, { backgroundColor: colors.muted, borderRadius: colors.radius, borderColor: colors.border }]}
              onPress={handleCapture}
              activeOpacity={0.8}
            >
              <Feather name="camera" size={48} color={colors.mutedForeground} style={{ marginBottom: 16 }} />
              <Text style={[styles.cameraText, { color: colors.foreground }]}>Tap to Capture</Text>
              <Text style={[styles.cameraSubtext, { color: colors.mutedForeground }]}>High quality evidence</Text>
            </TouchableOpacity>
          )}

          {capturedImage && (
            <View style={styles.formContainer}>
              <Text style={[styles.label, { color: colors.foreground }]}>Area (Optional)</Text>
              <TextInput
                style={[styles.input, { 
                  backgroundColor: colors.card, 
                  borderColor: colors.input,
                  color: colors.foreground,
                  borderRadius: colors.radius
                }]}
                placeholder="e.g. Master Bathroom"
                placeholderTextColor={colors.mutedForeground}
                value={area}
                onChangeText={setArea}
              />

              <Text style={[styles.label, { color: colors.foreground }]}>Note (Optional)</Text>
              <TextInput
                style={[styles.input, { 
                  backgroundColor: colors.card, 
                  borderColor: colors.input,
                  color: colors.foreground,
                  borderRadius: colors.radius,
                  minHeight: 80,
                  textAlignVertical: 'top'
                }]}
                placeholder="Specific concerns..."
                placeholderTextColor={colors.mutedForeground}
                value={note}
                onChangeText={setNote}
                multiline
              />
              <Text style={[styles.label, { color: colors.foreground }]}>Evidence classification</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([
                  ['client_report', 'Client report', 'Visible to the client'],
                  ['private_evidence', 'Private evidence', 'Inspector-only'],
                ] as const).map(([value, title, detail]) => (
                  <TouchableOpacity
                    key={value}
                    testID={`classification-${value}`}
                    onPress={() => setClassification(value)}
                    style={{
                      flex: 1,
                      padding: 12,
                      borderWidth: classification === value ? 2 : 1,
                      borderColor: classification === value ? colors.primary : colors.border,
                      borderRadius: colors.radius,
                      backgroundColor: classification === value ? colors.primary + '12' : colors.card,
                    }}
                  >
                    <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold', fontSize: 13 }}>{title}</Text>
                    <Text style={{ color: colors.mutedForeground, fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 4 }}>{detail}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {capturedImage && (
            <View style={styles.bottomActions}>
              <Button 
                testID="analyze-evidence-btn"
                title="Analyze Evidence" 
                icon={<Feather name="cpu" size={18} color={colors.primaryForeground} />}
                onPress={handleAnalyze} 
              />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    );
  };

  const renderAnalyze = () => {
    if (analyzeMutation.isError) {
      return (
        <ErrorState 
          message="Failed to analyze image. Ensure you are online and try again." 
          onRetry={handleAnalyze}
        />
      );
    }
    return <LoadingState message="Analyzing conditions..." />;
  };

  const renderReview = () => {
    if (!analysisResult) return null;

    return (
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => setStep('capture')} style={styles.backButton}>
              <Feather name="arrow-left" size={24} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Review Analysis</Text>
          </View>

          <Text style={[styles.summaryText, { color: colors.mutedForeground }]}>
            {analysisResult.summary}
          </Text>

          {analysisResult.findings.map((finding, idx) => {
            const isSelected = selectedFindings.has(idx);
            return (
              <TouchableOpacity 
                key={idx}
                onPress={() => toggleFindingSelection(idx)}
                activeOpacity={0.8}
                style={{ marginBottom: 12 }}
              >
                <Card style={{ 
                  borderColor: isSelected ? colors.primary : colors.border,
                  borderWidth: isSelected ? 2 : 1,
                }}>
                  <View style={styles.findingHeader}>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Feather 
                        name={isSelected ? "check-circle" : "circle"} 
                        size={20} 
                        color={isSelected ? colors.primary : colors.mutedForeground} 
                      />
                      <Text style={[styles.findingTitle, { color: colors.cardForeground }]}>{finding.label}</Text>
                    </View>
                    <View style={[styles.badge, { backgroundColor: colors.muted }]}>
                      <Text style={[styles.badgeText, { color: colors.mutedForeground }]}>
                        {Math.round(finding.confidence * 100)}% Match
                      </Text>
                    </View>
                  </View>
                  <View style={styles.findingBody}>
                    <Text style={[styles.findingObservation, { color: colors.foreground }]}>
                      {finding.observation}
                    </Text>
                    <Text style={[styles.findingRecommendation, { color: colors.mutedForeground }]}>
                      Recommendation: {finding.recommendation}
                    </Text>
                  </View>
                </Card>
              </TouchableOpacity>
            );
          })}

          <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>
            {analysisResult.disclaimer}
          </Text>
          
          <View style={{ height: 100 }} />
        </ScrollView>
        
        <View style={[styles.stickyFooter, { 
          backgroundColor: colors.background, 
          borderTopColor: colors.border,
          paddingBottom: (Platform.OS === 'web' ? 84 : 49) + insets.bottom + 16 
        }]}>
          <Button 
            testID="accept-findings-btn"
            title={`Accept ${selectedFindings.size} Finding${selectedFindings.size !== 1 ? 's' : ''}`}
            onPress={acceptFindings}
            disabled={selectedFindings.size === 0}
            icon={<Feather name="check" size={18} color={selectedFindings.size === 0 ? colors.mutedForeground : colors.primaryForeground} />}
          />
        </View>
      </View>
    );
  };

  if (sessionExpired) {
    return (
      <AuthShell
        eyebrow="SITEcheck FIELD AR"
        title="Session expired"
        description="Your sign-in expired before this capture could be saved."
      >
        <AuthNotice message="No finding was submitted. Sign in again, then retake the photo so it stays tied to the correct inspector account." />
        <AuthError message={sessionRecoveryError} />
        <Button
          title="Return to sign in"
          onPress={returnToSignIn}
          loading={isReturningToSignIn}
          testID="session-expired-sign-in-btn"
        />
      </AuthShell>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 84 : 44) }]}>
      {step === 'select_inspection' && renderSelectInspection()}
      {step === 'capture' && renderCapture()}
      {step === 'analyze' && renderAnalyze()}
      {step === 'review' && renderReview()}
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
  sectionTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 24,
    marginBottom: 20,
    letterSpacing: -0.5,
  },
  eyebrow: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    letterSpacing: 1.2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    gap: 16,
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 17,
  },
  cardSubtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  cameraPlaceholder: {
    height: 300,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  cameraText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 18,
    marginBottom: 4,
  },
  cameraSubtext: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
  },
  previewContainer: {
    height: 300,
    marginBottom: 24,
    position: 'relative',
  },
  previewImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  retakeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  formContainer: {
    gap: 12,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    marginBottom: -4,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
  },
  bottomActions: {
    marginTop: 32,
  },
  summaryText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  findingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  findingTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    flex: 1,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
  },
  findingBody: {
    paddingLeft: 28, // align with text past icon
    gap: 8,
  },
  findingObservation: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 20,
  },
  findingRecommendation: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    lineHeight: 18,
  },
  disclaimer: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 24,
    paddingHorizontal: 16,
  },
  stickyFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    paddingBottom: 32,
    borderTopWidth: 1,
  }
});
