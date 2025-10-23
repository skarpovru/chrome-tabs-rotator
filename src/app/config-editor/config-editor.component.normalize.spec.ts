import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfigEditorComponent } from './config-editor.component';
import { ConfigData } from '../models';

describe('ConfigEditorComponent URL normalization', () => {
  let fixture: ComponentFixture<ConfigEditorComponent>;
  let component: ConfigEditorComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConfigEditorComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ConfigEditorComponent);
    component = fixture.componentInstance;
    component.value = new ConfigData();
    fixture.detectChanges();
  });

  it('normalizes domain-only URL on save', () => {
    const pageGroup = component.pagesFormArray.at(0);
    pageGroup.get('url')!.setValue('example.org/path');
    pageGroup.get('delaySeconds')!.setValue(5);
    pageGroup.get('reloadIntervalSeconds')!.setValue(0);

    let emitted: ConfigData | undefined;
    component.valueChanges.subscribe(v => emitted = v);

    const fakeEvent = { preventDefault() {} } as any;
    component.onSaveConfig(fakeEvent);

    expect(emitted).toBeTruthy();
    expect(emitted!.pages[0].url).toBe('https://example.org/path');
  });
});
