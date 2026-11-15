import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, Router, provideRouter } from "@angular/router";
import { CaseForm } from "./case-form";

describe("Alta automática de cliente desde una causa",()=>{
  let component:CaseForm;
  let http:HttpTestingController;
  beforeEach(()=>{
    TestBed.configureTestingModule({providers:[
      provideHttpClient(),provideHttpClientTesting(),provideRouter([]),
      {provide:ActivatedRoute,useValue:{snapshot:{paramMap:new Map()}}},
    ]});
    http=TestBed.inject(HttpTestingController);
    component=TestBed.runInInjectionContext(()=>new CaseForm());
    http.expectOne("/api/users/clients").flush([]);
  });
  afterEach(()=>{component.ngOnDestroy();http.verify();vi.restoreAllMocks();});

  it("envía los datos del cliente nuevo y conserva la clave temporal antes de navegar",()=>{
    component.setClientMode("new");
    component.form.patchValue({
      title:"Cobro de honorarios",matter:"Civil",court:"Juzgado Civil",priority:"Media",
      newClientName:"Ana Cliente",newClientEmail:"ana@example.test",newClientPhone:"+56911112222",
    });
    const navigate=vi.spyOn(TestBed.inject(Router),"navigate").mockResolvedValue(true);
    component.submit();
    const request=http.expectOne({url:"/api/cases",method:"POST"});
    expect(request.request.body.clientId).toBeUndefined();
    expect(request.request.body.newClientEmail).toBe("ana@example.test");
    request.flush({
      id:"case-new",reference:"LC-20",version:1,title:"Cobro de honorarios",rit:null,
      clientId:"client-new",clientName:"Ana Cliente",matter:"Civil",court:"Juzgado Civil",
      priority:"Media",status:"Activa",nextDate:null,nextDateLabel:null,createdAt:"2026-11-15",updatedAt:"2026-11-15",
      onboarding:{clientCreated:true,temporaryPassword:"Lex-temporal-segura!",deliveryStatus:"PENDING"},
    });
    expect(component.onboarding()?.temporaryPassword).toBe("Lex-temporal-segura!");
    expect(navigate).not.toHaveBeenCalled();
    component.openCreatedCase();
    expect(navigate).toHaveBeenCalledWith(["/causas","case-new"]);
  });
});
