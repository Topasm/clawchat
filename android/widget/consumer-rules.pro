# Glance instantiates callbacks using Class.forName(...).getDeclaredConstructor().
# Its 1.2.0 rules retain the class but omit the constructor, which strict R8
# full mode removes. Keep names too: already-rendered widgets store them.
-keep class com.clawchat.android.widget.** implements androidx.glance.appwidget.action.ActionCallback {
    public <init>();
}
